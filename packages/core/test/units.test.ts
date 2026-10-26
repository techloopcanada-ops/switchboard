import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanup, tempHome } from './helpers.ts';

const home = tempHome();
const { defaultConfig, loadConfig, redactConfig, saveConfig, isMasked } = await import('../src/config.ts');
const { validateBot, builtinBots, effectivePolicy, saveBot, loadBots } = await import('../src/bots.ts');
const { parseSkillFile, validateSkillFrontmatter, writeUserSkill, loadSkills, readSkillBody } = await import('../src/skills.ts');
const { appendMemory, readBotMemory, readUserProfile, memoryPromptSection } = await import('../src/memory.ts');
const { SessionStore } = await import('../src/sessions.ts');
const { ApprovalCenter, summarizeToolCall } = await import('../src/approvals.ts');
const { parseWorkflow, saveWorkflowYaml, loadWorkflows, workflowToYaml } = await import('../src/workflows.ts');
const { referralLinks, REFERRAL_PROGRAMS } = await import('../src/referrals.ts');
const { resolveInside, htmlToText } = await import('../src/tools.ts');
const { sanitizeConfigPatch } = await import('../src/server.ts');

test.after(() => cleanup(home));

test('config: defaults persist with a random token and secrets are redacted', () => {
  const config = loadConfig();
  assert.equal(config.version, 1);
  assert.ok(config.token.length >= 30);
  assert.equal(loadConfig().token, config.token);
  config.providers.openai = { kind: 'builtin', apiKey: 'sk-live-1234567890abcdef' };
  saveConfig(config);
  const redacted = redactConfig(loadConfig());
  assert.notEqual(redacted.providers.openai?.apiKey, 'sk-live-1234567890abcdef');
  assert.ok(isMasked(redacted.providers.openai?.apiKey));
  assert.ok(isMasked(redacted.token));
  assert.ok(!isMasked('sk-real-key'));
  assert.notDeepEqual(defaultConfig().token, defaultConfig().token);
});

test('bots: validation rejects bad ids and policies; builtin bots save and load', () => {
  assert.throws(() => validateBot({ id: 'Bad Id', name: 'x', systemPrompt: '', model: { provider: 'a', id: 'b' }, tools: '*', skills: '*' }), /Bot id/);
  assert.throws(() => validateBot({ id: 'ok', name: 'x', systemPrompt: '', model: { provider: 'a', id: 'b' }, tools: '*', skills: '*', policy: { shell: 'sometimes' } }), /auto, ask or never/);
  assert.throws(() => validateBot({ id: 'ok', name: 'x', systemPrompt: '', model: { provider: 'a', id: 'b' }, tools: '*', skills: '*', policy: { nuclear: 'auto' } }), /Unknown tool category/);
  const bots = builtinBots({ provider: 'openrouter', id: 'm' });
  assert.deepEqual(bots.map(b => b.id), ['assistant', 'coder', 'guide']);
  for (const b of bots) saveBot(b);
  assert.equal(loadBots().length, 3);
  const coder = loadBots().find(b => b.id === 'coder')!;
  assert.equal(effectivePolicy(coder, 'read'), 'auto');
  assert.equal(effectivePolicy(coder, 'shell'), 'ask');
  assert.equal(effectivePolicy({ ...coder, policy: { shell: 'never' } }, 'shell'), 'never');
});

test('skills: agentskills.io frontmatter rules are enforced and bodies load on demand', () => {
  const parsed = parseSkillFile('---\nname: demo-skill\ndescription: Does demo things. Use for demos.\n---\n\n# Steps\n1. go');
  assert.equal(parsed.frontmatter.name, 'demo-skill');
  assert.throws(() => validateSkillFrontmatter({ name: 'Demo', description: 'x' }, 'Demo'), /lowercase/);
  assert.throws(() => validateSkillFrontmatter({ name: 'a--b', description: 'x' }, 'a--b'), /lowercase/);
  assert.throws(() => validateSkillFrontmatter({ name: 'demo', description: 'x' }, 'other'), /must match/);
  assert.throws(() => validateSkillFrontmatter({ name: 'demo', description: '' }, 'demo'), /description/);
  assert.throws(() => parseSkillFile('no frontmatter'), /frontmatter/);
  const skill = writeUserSkill('deploy-notes', 'How to deploy: use when asked to deploy.', '# Deploy\n\n1. build\n2. ship');
  const found = loadSkills().find(s => s.name === 'deploy-notes');
  assert.ok(found);
  assert.equal(found.source, 'user');
  assert.equal(readSkillBody(found), '# Deploy\n\n1. build\n2. ship');
  assert.ok(loadSkills().some(s => s.name === 'switchboard-basics' && s.source === 'bundled'));
  assert.equal(skill.dir, found.dir);
});

test('memory: notes append, are bounded and render into the prompt', () => {
  appendMemory({ botId: 'coder' }, 'Prefers tabs');
  appendMemory({ user: true }, 'Name is Cam');
  assert.match(readBotMemory('coder'), /Prefers tabs/);
  assert.match(readUserProfile(), /Name is Cam/);
  for (let i = 0; i < 600; i++) appendMemory({ botId: 'coder' }, `note ${i} ${'x'.repeat(40)}`);
  assert.ok(readBotMemory('coder').length <= 12_000);
  assert.ok(!readBotMemory('coder').includes('Prefers tabs'), 'oldest notes drop first');
  assert.match(memoryPromptSection('coder', true), /MEMORY\.md/);
  assert.equal(memoryPromptSection('coder', false), '');
});

test('sessions: sqlite store round-trips transcripts, usage and approvals log', () => {
  const store = new SessionStore(path.join(home, 'test.db'));
  const s = store.getOrCreateSession('coder', 'web:default', 'web');
  assert.equal(store.getOrCreateSession('coder', 'web:default', 'web').id, s.id);
  store.replaceMessages(s.id, [{ role: 'user', content: 'hi', timestamp: 1 }, { role: 'assistant', content: [], timestamp: 2 }], 'hi');
  assert.equal(store.loadMessages(s.id).length, 2);
  assert.equal(store.listSessions('coder')[0]?.title, 'hi');
  store.addUsage({ botId: 'coder', sessionId: s.id, provider: 'p', model: 'm', input: 10, output: 5, cost: 0.25 });
  store.addUsage({ botId: 'coder', provider: 'p', model: 'm', input: 10, output: 5, cost: 0.5 });
  assert.equal(store.monthlyCost('coder'), 0.75);
  assert.equal(store.monthlyCost('other'), 0);
  store.logApproval({ id: 'a1', botId: 'coder', tool: 'shell', args: { command: 'ls' }, decision: 'allow', decidedBy: 'test', createdAt: 1 });
  assert.equal(store.recentApprovals()[0]?.id, 'a1');
  store.resetSession(s.id);
  assert.equal(store.loadMessages(s.id).length, 0);
  store.close();
});

test('approvals: first decision wins, timeouts deny, abort resolves', async () => {
  const center = new ApprovalCenter(5_000);
  const created: string[] = [];
  center.on('created', r => created.push(r.id));
  const base = { botId: 'coder', botName: 'Coder', chatKey: 'web:x', channel: 'web', toolName: 'shell', category: 'shell' as const, summary: 'Run: ls', args: { command: 'ls' } };
  const p = center.request(base);
  assert.equal(center.list().length, 1);
  assert.equal(center.decide(created[0]!, 'allow', 'tester'), true);
  assert.equal(center.decide(created[0]!, 'deny', 'tester'), false, 'second decision is ignored');
  const resolved = await p;
  assert.equal(resolved.decision, 'allow');
  assert.equal(resolved.decidedBy, 'tester');
  assert.equal(center.list().length, 0);
  const controller = new AbortController();
  const aborted = center.request(base, controller.signal);
  controller.abort();
  assert.equal((await aborted).decision, 'aborted');
  const fast = new ApprovalCenter(1);
  const timed = await fast.request(base);
  assert.equal(timed.decision, 'timeout');
  assert.match(summarizeToolCall('shell', { command: 'npm test' }), /Run: npm test/);
  assert.match(summarizeToolCall('write_file', { path: 'a.txt', content: 'abc' }), /Write file a.txt \(3 chars\)/);
});

test('workflows: yaml parses, validates cron and round-trips through files', () => {
  const w = parseWorkflow(workflowToYaml({ name: 'morning', cron: '0 9 * * 1-5', bot: 'assistant', prompt: 'Summarise my day', deliver: [{ channel: 'telegram', chatId: '123' }] }), 'x.yaml');
  assert.equal(w.trigger.type, 'cron');
  assert.equal(w.deliver[0]?.chatId, '123');
  assert.equal(w.approval, 'inherit');
  assert.throws(() => parseWorkflow('name: bad\nbot: a\nprompt: p\ntrigger:\n  type: cron\n  expression: "99 99 * * *"', 'x'), /Invalid cron/);
  assert.throws(() => parseWorkflow('name: Bad Name\nbot: a\nprompt: p', 'x'), /lowercase/);
  assert.throws(() => parseWorkflow('name: x\nbot: a\nprompt: p\ntrigger:\n  type: webhook', 'x'), /Unknown trigger/);
  saveWorkflowYaml('morning', workflowToYaml({ name: 'morning', cron: '0 9 * * 1-5', bot: 'assistant', prompt: 'hi' }));
  assert.throws(() => saveWorkflowYaml('other', workflowToYaml({ name: 'morning', bot: 'a', prompt: 'p' })), /must match/);
  fs.writeFileSync(path.join(home, 'workflows', 'broken.yaml'), 'name: broken\nprompt: p');
  const loaded = loadWorkflows();
  assert.equal(loaded.workflows.length, 1);
  assert.match(loaded.errors['broken.yaml'] ?? '', /bot/);
});

test('referrals: plain links without codes, affiliate links with codes, always disclosed', () => {
  const plain = referralLinks({});
  assert.ok(plain.every(l => !l.affiliate));
  const withCode = referralLinks({ digitalocean: 'abc123', openrouter: 'ignored' });
  assert.equal(withCode.find(l => l.id === 'digitalocean')?.href, 'https://m.do.co/c/abc123');
  assert.equal(withCode.find(l => l.id === 'openrouter')?.affiliate, false, 'programmes without a template never become affiliate links');
  assert.ok(REFERRAL_PROGRAMS.every(p => p.evidence && p.reward && p.applyUrl));
});

test('tools: paths stay inside the working directory and never reach Switchboard home', () => {
  const workdir = path.join(home, 'workspace');
  fs.mkdirSync(workdir, { recursive: true });
  assert.equal(resolveInside(workdir, 'a/b.txt'), path.join(workdir, 'a', 'b.txt'));
  assert.throws(() => resolveInside(workdir, '../config.json'), /inside the working directory|not allowed/);
  assert.throws(() => resolveInside(workdir, path.join(home, 'config.json')), /not allowed|inside/);
  const outside = path.join(home, '..', 'elsewhere');
  assert.throws(() => resolveInside(outside, path.join(home, 'config.json')), /not allowed|inside/);
  assert.equal(htmlToText('<html><script>x()</script><h1>Hi</h1><p>there &amp; you</p></html>'), 'Hi\nthere & you');
});

test('models: keyless OpenAI-compatible servers resolve a placeholder key and ad-hoc model ids', async () => {
  const { ModelRegistry } = await import('../src/models.ts');
  const registry = new ModelRegistry();
  await registry.applyConfig({ ...defaultConfig(), providers: { ollama: { kind: 'openai-compatible', name: 'Ollama', baseUrl: 'http://127.0.0.1:1/v1/' } } });
  const auth = await registry.checkAuth('ollama');
  assert.equal(auth?.auth.apiKey, 'switchboard-local');
  const model = registry.getModel('ollama', 'llama3.2');
  assert.equal(model?.api, 'openai-completions');
  assert.equal(model?.baseUrl, 'http://127.0.0.1:1/v1');
  assert.equal(registry.getModel('nope', 'x'), undefined);
  const openrouter = registry.getModel('openrouter', 'anthropic/claude-sonnet-4.5');
  assert.ok(openrouter, 'built-in catalog includes OpenRouter models');
  assert.equal(await registry.checkAuth('openrouter'), undefined, 'no key configured');
});

test('pairing: Wi-Fi first, VPN next, hypervisor adapters last', async () => {
  const { rankPairingCandidates } = await import('../src/runtime.ts');
  const v4 = (address: string, internal = false) => ({ address, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` });
  const ranked = rankPairingCandidates({
    'vEthernet (WSL (Hyper-V firewall))': [v4('172.27.0.1')],
    'Tailscale': [v4('100.108.128.26')],
    'Wi-Fi': [v4('10.0.0.133')],
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
  }, 7787);
  assert.deepEqual(ranked.map(c => [c.kind, c.address]), [['lan', '10.0.0.133'], ['vpn', '100.108.128.26'], ['virtual', '172.27.0.1']]);
  assert.equal(ranked[0]?.url, 'http://10.0.0.133:7787');
  assert.match(ranked[2]?.note ?? '', /cannot reach/);
});

test('server: config patches keep masked secrets and reject bad values', () => {
  const current = { ...defaultConfig(), providers: { openai: { kind: 'builtin' as const, apiKey: 'sk-old' } }, telegram: { token: 'tg-old', allowedUserIds: [1] } };
  const patch = sanitizeConfigPatch(current, { providers: { openai: { kind: 'builtin', apiKey: 'sk-o…-old' } }, telegram: { token: '••••', allowedUserIds: [1, 2] }, approvalTimeoutSec: 60 });
  assert.equal(patch.providers?.openai?.apiKey, 'sk-old');
  assert.equal(patch.telegram?.token, 'tg-old');
  assert.deepEqual(patch.telegram?.allowedUserIds, [1, 2]);
  assert.equal(patch.approvalTimeoutSec, 60);
  assert.equal(sanitizeConfigPatch(current, { providers: { openai: { kind: 'builtin', apiKey: '' } } }).providers?.openai?.apiKey, undefined, 'empty key clears');
  assert.throws(() => sanitizeConfigPatch(current, { providers: { ollama: { kind: 'openai-compatible' } } }), /baseUrl/);
  assert.throws(() => sanitizeConfigPatch(current, { providers: { 'Bad Id': { kind: 'builtin' } } }), /Invalid provider id/);
  assert.equal(sanitizeConfigPatch(current, { telegram: null }).telegram, undefined);
});
