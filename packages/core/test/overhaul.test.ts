import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { cleanup, tempHome } from './helpers.ts';

const home = tempHome('switchboard-overhaul-');
const { Switchboard } = await import('../src/runtime.ts');
const { saveBot, builtinBots, upgradeBuiltinBot, BUILTIN_VERSION } = await import('../src/bots.ts');
const { parseProposal, buildDigest } = await import('../src/learning.ts');
const { createServer, listen } = await import('../src/server.ts');

const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
const model = { provider: 'faux', id: 'faux-1' };
for (const bot of builtinBots(model)) saveBot(bot);
saveBot({ ...builtinBots(model)[1]!, id: 'trusting', name: 'Trusting', builtin: false });

const sb = await Switchboard.create();
sb.registry.models.setProvider(faux.provider);

const ctx = { botId: 'coder', chatKey: 'web:cmd' };
/** Approve every request of the given tool as the human would. Returns a remover. */
function autoApprove(tool: string, remember = false): () => void {
  const handler = (request: { id: string; toolName: string }) => { if (request.toolName === tool) sb.approvals.decide(request.id, 'allow', 'test', remember); };
  sb.approvals.on('created', handler);
  return () => { sb.approvals.off('created', handler); };
}

test.after(async () => {
  await sb.shutdown();
  cleanup(home);
});

test('chats are saved message by message, so nothing is lost mid-run', async () => {
  faux.setResponses([fauxAssistantMessage([fauxToolCall('write_file', { path: 'n.txt', content: 'x' })]), fauxAssistantMessage('done')]);
  let during: string[] = [];
  sb.approvals.once('created', request => {
    const session = sb.store.findSession('coder', 'web:persist');
    during = session ? sb.store.loadMessages<{ role: string }>(session.id).map(m => m.role) : [];
    sb.approvals.decide(request.id, 'allow', 'test');
  });
  await sb.chat({ botId: 'coder', chatKey: 'web:persist', channel: 'web', text: 'write a note please' });
  assert.deepEqual(during, ['user', 'assistant'], 'user message and the tool call were already stored while the approval was pending');
  const session = sb.store.findSession('coder', 'web:persist')!;
  assert.deepEqual(sb.store.loadMessages<{ role: string }>(session.id).map(m => m.role), ['user', 'assistant', 'toolResult', 'assistant']);
  assert.equal(session.title, 'write a note please');
  // A second message continues the same transcript with contiguous numbering.
  faux.setResponses([fauxAssistantMessage('again')]);
  await sb.chat({ botId: 'coder', chatKey: 'web:persist', channel: 'web', text: 'and again' });
  assert.equal(sb.store.messageCount(session.id), 6);
});

test('opening a conversation never creates one; empty ones are hidden and purged', () => {
  assert.equal(sb.store.findSession('coder', 'web:never-used'), undefined);
  sb.store.getOrCreateSession('coder', 'web:empty', 'web');
  assert.ok(!sb.store.listSessions().some(s => s.chatKey === 'web:empty'), 'empty conversation is not listed');
  assert.ok(sb.store.listSessions().some(s => s.chatKey === 'web:persist' && (s.messageCount ?? 0) === 6 && s.preview === 'and again'));
  assert.ok(sb.store.purgeEmptySessions(-1) >= 1);
  assert.equal(sb.store.findSession('coder', 'web:empty'), undefined);
});

test('slash commands are answered locally; paths and unknown words go to the model', async () => {
  const bot = await sb.command('/bot assistant', ctx);
  assert.equal(bot?.switchBot, 'assistant');
  assert.match((await sb.command('/bot nobody', ctx))?.reply ?? '', /No bot called "nobody"/);
  assert.equal((await sb.command('/new', ctx))?.newConversation, true);
  assert.match((await sb.command('/help', ctx))?.reply ?? '', /\/learn/);
  assert.match((await sb.command('/bots', ctx))?.reply ?? '', /Coder — \/bot coder {2}\(current\)/);
  assert.equal(await sb.command('/etc/hosts is a file', ctx), null);
  assert.equal(await sb.command('/madeupword', ctx), null);
  assert.equal(await sb.command('hello /new', ctx), null);
  assert.match((await sb.command('/usage', ctx))?.reply ?? '', /Total this month/);
});

test('a saved skill is usable immediately, in the same run and by the API', async () => {
  const stop = autoApprove('save_skill');
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('save_skill', { name: 'release-notes', description: 'Write release notes. Use when asked for a changelog.', body: '# Goal\nWrite a changelog.\n1. Run git log --oneline.\n2. Group by feature and fix.' })]),
    fauxAssistantMessage([fauxToolCall('load_skill', { name: 'release-notes' })]),
    fauxAssistantMessage('Saved and loaded.'),
  ]);
  const outputs: string[] = [];
  await sb.chat({ botId: 'coder', chatKey: 'web:skill', channel: 'web', text: 'remember how to do release notes', onEvent: e => { if (e.type === 'tool_end') outputs.push(e.output); } });
  stop();
  assert.match(outputs[0] ?? '', /Saved skill release-notes/);
  assert.match(outputs[1] ?? '', /git log --oneline/, 'load_skill found the skill written seconds earlier');
  assert.ok(sb.listSkills().some(s => s.name === 'release-notes'));
  // A skill dropped on disk by hand or by another process appears without a restart.
  const dir = path.join(home, 'skills', 'by-hand');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: by-hand\ndescription: Added outside the app.\n---\n\nSteps.');
  assert.ok(sb.listSkills().some(s => s.name === 'by-hand'));
});

test('learning: after enough tool work the bot proposes a skill, saved only when approved', async () => {
  const calls = [1, 2, 3, 4].map(i => fauxToolCall('list_dir', { path: '.' }, { id: `call-${i}` }));
  const proposal = { save: true, name: 'workspace-tour', description: 'Tour a project folder. Use when asked what is in a workspace.', body: '# Goal\nList the workspace.\n1. Run list_dir on the root.\n2. Open README first.\n3. Summarise the layout.' };
  faux.setResponses([fauxAssistantMessage(calls), fauxAssistantMessage('Finished listing.'), fauxAssistantMessage(JSON.stringify(proposal))]);
  const proposed: string[] = [];
  const handler = (request: { id: string; toolName: string; summary: string }) => {
    if (request.toolName !== 'save_skill') return;
    proposed.push(request.summary);
    sb.approvals.decide(request.id, 'allow', 'test');
  };
  sb.approvals.on('created', handler);
  const learned = new Promise<string>(resolve => sb.once('skill_learned', resolve));
  await sb.chat({ botId: 'coder', chatKey: 'web:learn', channel: 'web', text: 'look around the project' });
  await sb.idle();
  sb.approvals.off('created', handler);
  assert.equal(await learned, 'workspace-tour');
  assert.match(proposed[0] ?? '', /Learn skill "workspace-tour"/);
  assert.ok(sb.listSkills().some(s => s.name === 'workspace-tour'));
  assert.ok(fs.existsSync(path.join(home, 'skills', 'workspace-tour', 'SKILL.md')));
});

test('learning: a declined suggestion saves nothing, and /learn explains when there is nothing to keep', async () => {
  faux.setResponses([fauxAssistantMessage('{"save": false, "reason": "This was a general question."}')]);
  const reply = await sb.command('/learn', { botId: 'coder', chatKey: 'web:persist' });
  assert.equal(reply?.reply, 'This was a general question.');
  const none = await sb.command('/learn', { botId: 'coder', chatKey: 'web:no-such-chat' });
  assert.match(none?.reply ?? '', /nothing in this conversation/);
  const proposal = { save: true, name: 'declined-skill', description: 'Should not be saved.', body: '# Goal\nNever saved.\n1. This step list is long enough to pass validation.\n2. And so is this one.' };
  faux.setResponses([fauxAssistantMessage(JSON.stringify(proposal))]);
  const asked = new Promise<{ id: string }>(resolve => sb.approvals.once('created', resolve));
  const outcome = sb.command('/learn save the steps', { botId: 'coder', chatKey: 'web:persist' });
  const request = await asked;
  sb.approvals.decide(request.id, 'deny', 'test');
  assert.match((await outcome)?.reply ?? '', /Suggested skill "declined-skill"/);
  await sb.idle();
  assert.ok(!sb.listSkills().some(s => s.name === 'declined-skill'));
});

test('always allow: the choice sticks to the bot and its category', async () => {
  sb.reloadBots();
  faux.setResponses([fauxAssistantMessage([fauxToolCall('write_file', { path: 'a.txt', content: '1' })]), fauxAssistantMessage('ok')]);
  const stop = autoApprove('write_file', true);
  await sb.chat({ botId: 'trusting', chatKey: 'web:trust', channel: 'web', text: 'write a.txt' });
  stop();
  assert.equal(sb.getBot('trusting')?.policy.write, 'auto');
  assert.equal(sb.getBot('coder')?.policy.write, undefined, 'other bots are untouched');
  let asked = 0;
  const count = () => { asked++; };
  sb.approvals.on('created', count);
  faux.setResponses([fauxAssistantMessage([fauxToolCall('write_file', { path: 'b.txt', content: '2' })]), fauxAssistantMessage('ok')]);
  await sb.chat({ botId: 'trusting', chatKey: 'web:trust', channel: 'web', text: 'write b.txt' });
  sb.approvals.off('created', count);
  assert.equal(asked, 0, 'no further prompts for writes');
  assert.ok(fs.existsSync(path.join(home, 'workspace', 'b.txt')));
});

test('built-in bots from an older install gain the new tools without losing their settings', () => {
  const fresh = builtinBots(model).find(b => b.id === 'assistant')!;
  const old = { ...fresh, tools: ['read_file', 'remember'], builtinVersion: undefined, budgetUsd: 5 };
  const upgraded = upgradeBuiltinBot(old, fresh);
  assert.ok(upgraded.tools !== '*' && upgraded.tools.includes('save_skill') && upgraded.tools.includes('read_file'));
  assert.equal(upgraded.builtinVersion, BUILTIN_VERSION);
  assert.equal(upgraded.budgetUsd, 5);
  const custom = { ...old, builtin: false };
  assert.equal(upgradeBuiltinBot(custom, fresh), custom, 'user-made bots are never touched');
  assert.equal(upgradeBuiltinBot(fresh, fresh), fresh, 'current bots are returned unchanged');
});

test('skill proposals: valid JSON is accepted, everything else is rejected with a reason', () => {
  const body = 'x'.repeat(60);
  const ok = parseProposal('```json\n' + JSON.stringify({ save: true, name: 'a-b', description: 'Does a thing.', body }) + '\n```');
  assert.ok('proposal' in ok && ok.proposal.name === 'a-b');
  assert.deepEqual(parseProposal('{"save": false, "reason": "nope"}'), { reason: 'nope' });
  assert.match((parseProposal('hello') as { reason: string }).reason, /did not return/);
  assert.match((parseProposal(JSON.stringify({ save: true, name: 'Bad Name', description: 'd', body })) as { reason: string }).reason, /invalid/);
  assert.match((parseProposal(JSON.stringify({ save: true, name: 'ok-name', description: 'd', body: 'short' })) as { reason: string }).reason, /no real instructions/);
  const long = Array.from({ length: 400 }, (_, i) => ({ role: 'user' as const, content: `message number ${i} ${'y'.repeat(80)}`, timestamp: i }));
  const digest = buildDigest(long, ['one-skill']);
  assert.ok(digest.startsWith('Existing skills: one-skill'));
  assert.ok(digest.length < 14_600);
  assert.match(digest, /earlier steps omitted/);
});

test('HTTP: commands, conversation list across bots, rename and delete', async () => {
  const handle = createServer(sb, { webDir: path.join(home, 'no-web') });
  await listen(handle, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(handle.server.address() as { port: number }).port}`;
  const headers = { authorization: `Bearer ${sb.config.token}`, 'content-type': 'application/json' };
  const get = async (p: string) => (await fetch(`${base}${p}`, { headers })).json() as Promise<any>;
  const send = async (method: string, p: string, body?: unknown) => (await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;

  const cmd = await send('POST', '/api/chat', { botId: 'coder', chatKey: 'web:http', text: '/bot assistant' });
  assert.equal(cmd.command.switchBot, 'assistant');
  assert.equal((await get('/api/sessions?bot=coder&chat=web%3Aghost')).session, null);
  assert.ok(!(await get('/api/sessions/list')).some((s: { chatKey: string }) => s.chatKey === 'web:ghost'));

  faux.setResponses([fauxAssistantMessage('hello from assistant')]);
  await send('POST', '/api/chat', { botId: 'assistant', chatKey: 'web:http2', text: 'hi there' });
  const list = await get('/api/sessions/list') as { id: string; botId: string; chatKey: string; title: string; messageCount: number }[];
  assert.ok(list.some(s => s.botId === 'coder') && list.some(s => s.botId === 'assistant'), 'conversations from every bot are listed together');
  const mine = list.find(s => s.chatKey === 'web:http2')!;
  assert.equal(mine.title, 'hi there');
  assert.equal((await send('PUT', `/api/sessions/${mine.id}`, { title: 'Greeting test' })).ok, true);
  assert.equal(((await get('/api/sessions/list')) as { id: string; title: string }[]).find(s => s.id === mine.id)?.title, 'Greeting test');
  assert.equal((await send('DELETE', `/api/sessions/${mine.id}`)).ok, true);
  assert.ok(!((await get('/api/sessions/list')) as { id: string }[]).some(s => s.id === mine.id));
  await handle.close();
});
