import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { cleanup, tempHome } from './helpers.ts';

const home = tempHome('switchboard-runtime-');
const { Switchboard } = await import('../src/runtime.ts');
const { saveBot, builtinBots } = await import('../src/bots.ts');
const { createServer, listen } = await import('../src/server.ts');

const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
const model = { provider: 'faux', id: 'faux-1' };
for (const bot of builtinBots(model)) saveBot(bot);

const sb = await Switchboard.create();
sb.registry.models.setProvider(faux.provider);

test.after(async () => {
  await sb.shutdown();
  cleanup(home);
});

test('runtime: a chat streams deltas, persists the transcript and records cost', async () => {
  faux.setResponses([fauxAssistantMessage('Hello from faux')]);
  const deltas: string[] = [];
  const result = await sb.chat({ botId: 'assistant', chatKey: 'web:t1', channel: 'web', text: 'hi', onEvent: e => { if (e.type === 'delta') deltas.push(e.text); } });
  assert.equal(result.text, 'Hello from faux');
  assert.equal(deltas.join(''), 'Hello from faux');
  assert.ok(result.costUsd >= 0);
  const session = sb.store.getOrCreateSession('assistant', 'web:t1', 'web');
  const messages = sb.store.loadMessages<{ role: string }>(session.id);
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(session.title, 'hi');
  assert.equal(sb.store.monthlyUsage('assistant')[0]?.requests, 1, 'every assistant turn is recorded for budgets');
});

test('runtime: write tools pause for approval; allow runs them, deny blocks them', async () => {
  const workdir = path.join(home, 'workspace');
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('write_file', { path: 'hello.txt', content: 'hi there' })]),
    fauxAssistantMessage('File written.'),
  ]);
  const seen: string[] = [];
  const off = sb.approvals.on('created', r => { seen.push(r.summary); sb.approvals.decide(r.id, 'allow', 'test'); });
  const ok = await sb.chat({ botId: 'coder', chatKey: 'web:t2', channel: 'web', text: 'write hello' });
  assert.equal(ok.text, 'File written.');
  assert.equal(fs.readFileSync(path.join(workdir, 'hello.txt'), 'utf8'), 'hi there');
  assert.match(seen[0] ?? '', /Write file hello.txt/);
  off.removeAllListeners('created');

  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('write_file', { path: 'secret.txt', content: 'no' })]),
    fauxAssistantMessage('Understood, not writing.'),
  ]);
  sb.approvals.once('created', r => sb.approvals.decide(r.id, 'deny', 'test'));
  const denied = await sb.chat({ botId: 'coder', chatKey: 'web:t2', channel: 'web', text: 'write secret' });
  assert.equal(denied.text, 'Understood, not writing.');
  assert.ok(!fs.existsSync(path.join(workdir, 'secret.txt')));
  const log = sb.store.recentApprovals();
  assert.deepEqual(log.slice(0, 2).map(r => r.decision), ['deny', 'allow']);
});

test('runtime: read tools run without approval and stay inside the workdir', async () => {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_file', { path: 'hello.txt' })]),
    fauxAssistantMessage([fauxToolCall('read_file', { path: '../config.json' })]),
    fauxAssistantMessage('done'),
  ]);
  const tools: { name: string; isError: boolean; output: string }[] = [];
  let approvals = 0;
  const listener = () => { approvals++; };
  sb.approvals.on('created', listener);
  await sb.chat({ botId: 'coder', chatKey: 'web:t3', channel: 'web', text: 'read', onEvent: e => { if (e.type === 'tool_end') tools.push({ name: e.toolName, isError: e.isError, output: e.output }); } });
  sb.approvals.off('created', listener);
  assert.equal(approvals, 0);
  assert.equal(tools[0]?.isError, false);
  assert.match(tools[0]?.output ?? '', /hi there/);
  assert.equal(tools[1]?.isError, true);
  assert.match(tools[1]?.output ?? '', /working directory|not allowed/);
});

test('runtime: a bot with a never policy blocks shell without asking; budgets stop runs', async () => {
  saveBot({ ...builtinBots(model)[1]!, id: 'locked', name: 'Locked', policy: { shell: 'never' } });
  sb.reloadBots();
  faux.setResponses([fauxAssistantMessage([fauxToolCall('shell', { command: 'echo hi' })]), fauxAssistantMessage('blocked ok')]);
  const result = await sb.chat({ botId: 'locked', chatKey: 'web:t4', channel: 'web', text: 'run' });
  assert.equal(result.text, 'blocked ok');
  saveBot({ ...builtinBots(model)[0]!, id: 'tight', name: 'Tight', budgetUsd: 1 });
  sb.reloadBots();
  faux.setResponses([fauxAssistantMessage('first')]);
  const first = await sb.chat({ botId: 'tight', chatKey: 'web:t5', channel: 'web', text: 'one' });
  assert.equal(first.text, 'first');
  sb.store.addUsage({ botId: 'tight', provider: 'faux', model: 'faux-1', input: 1_000_000, output: 0, cost: 1 });
  const over = await sb.chat({ botId: 'tight', chatKey: 'web:t5', channel: 'web', text: 'two' });
  assert.match(over.error ?? '', /monthly budget/);
});

test('runtime: guide bot describes the live installation', async () => {
  faux.setResponses([fauxAssistantMessage([fauxToolCall('describe_capabilities', {})]), fauxAssistantMessage('explained')]);
  let output = '';
  await sb.chat({ botId: 'guide', chatKey: 'web:t6', channel: 'web', text: 'what can you do', onEvent: e => { if (e.type === 'tool_end') output = e.output; } });
  assert.match(output, /Bots:/);
  assert.match(output, /switchboard-basics/);
});

test('server: bootstrap is loopback-only, routes need the token, chat works over HTTP', async () => {
  const handle = createServer(sb, { webDir: path.join(home, 'no-web') });
  await listen(handle, '127.0.0.1', 0);
  const port = (handle.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const boot = await (await fetch(`${base}/api/bootstrap`)).json() as { token: string };
  assert.equal(boot.token, sb.config.token);
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  const headers = { authorization: `Bearer ${boot.token}`, 'content-type': 'application/json' };
  const status = await (await fetch(`${base}/api/status`, { headers })).json() as { bots: { id: string }[] };
  assert.ok(status.bots.some(b => b.id === 'coder'));
  faux.setResponses([fauxAssistantMessage('http reply')]);
  const chat = await (await fetch(`${base}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ botId: 'assistant', chatKey: 'web:http', text: 'hello' }) })).json() as { text: string };
  assert.equal(chat.text, 'http reply');
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Switchboard/);
  const referrals = await (await fetch(`${base}/api/referrals`, { headers })).json() as { disclosure: string; links: unknown[] };
  assert.ok(referrals.disclosure.includes('affiliate'));
  await handle.close();
});
