import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import WebSocket from 'ws';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';

test('web contracts against the real daemon with isolated storage', { timeout: 45000 }, async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'switchboard-web-smoke-'));
  const previousHome = process.env.SWITCHBOARD_HOME;
  process.env.SWITCHBOARD_HOME = home;
  let app;
  let socket;
  const modelServer = createHttpServer((req, res) => {
    assert.equal(req.url, '/v1/models');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }));
  });
  t.after(async () => {
    socket?.terminate();
    await app?.stop();
    if (modelServer.listening) await new Promise(resolve => modelServer.close(resolve));
    if (previousHome === undefined) delete process.env.SWITCHBOARD_HOME;
    else process.env.SWITCHBOARD_HOME = previousHome;
    assert.equal(path.dirname(home), path.resolve(tmpdir()));
    assert.ok(path.basename(home).startsWith('switchboard-web-smoke-'));
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const { startSwitchboard, defaultConfig, saveConfig, workflowToYaml } = await import('../../../packages/core/dist/index.js');
  const config = defaultConfig();
  config.server.port = 0;
  saveConfig(config);
  app = await startSwitchboard({ webDir: fileURLToPath(new URL('../dist/', import.meta.url)), log() {} });
  const base = `http://127.0.0.1:${app.server.server.address().port}`;
  const token = config.token;
  async function request(route, method = 'GET', body, expected = 200) {
    const response = await fetch(`${base}/api/${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(value)}`);
    return value;
  }

  await t.test('built UI, bootstrap and HTTP authentication', async () => {
    const html = await (await fetch(base)).text();
    assert.match(html, /<div id="root"><\/div>/);
    assert.match(html, /assets\//);
    const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
    assert.equal(bootstrap.token, token);
    assert.equal((await fetch(`${base}/api/bots`)).status, 401);
    assert.equal((await request('status')).version, '0.1.0');
  });

  await t.test('settings, masked secrets, model discovery and referral disclosure', async () => {
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${modelServer.address().port}/v1`;
    const saved = await request('config', 'PUT', {
      providers: { 'smoke-local': { kind: 'openai-compatible', name: 'Smoke local', apiKey: 'inert-smoke-key', baseUrl } },
      defaultModel: { provider: 'smoke-local', id: 'smoke-model' }, approvalTimeoutSec: 30, guideBot: true,
      referralCodes: { novita: 'smoke-code' },
    });
    assert.notEqual(saved.providers['smoke-local'].apiKey, 'inert-smoke-key');
    await request('config', 'PUT', { providers: saved.providers });
    assert.equal(app.sb.config.providers['smoke-local'].apiKey, 'inert-smoke-key');
    const refreshed = await request('providers?refresh=1');
    assert.deepEqual(refreshed.errors, {});
    const local = refreshed.providers.find(p => p.id === 'smoke-local');
    assert.equal(local.configured, true);
    assert.equal(local.models[0].id, 'smoke-model');
    const referrals = await request('referrals');
    assert.match(referrals.disclosure, /affiliate/);
    assert.equal(referrals.links.find(link => link.id === 'novita').affiliate, true);
    assert.deepEqual((await request('channels')).connected, []);
    assert.deepEqual((await request('channels/restart', 'POST')).connected, []);
  });

  const faux = fauxProvider({ provider: 'smoke-faux', models: [{ id: 'one', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
  app.sb.registry.models.setProvider(faux.provider);
  let bot;
  await t.test('bot create, update and usage', async () => {
    const original = (await request('bots')).find(b => b.id === 'assistant');
    bot = { ...original, id: 'smoke-bot', name: 'Smoke bot', builtin: false, model: { provider: 'smoke-faux', id: 'one' }, memory: false, tools: [], skills: [], policy: { shell: 'never' }, budgetUsd: 5 };
    const created = await request('bots/smoke-bot', 'PUT', bot);
    assert.equal(created.budgetUsd, 5);
    assert.equal(created.policy.shell, 'never');
    bot = { ...bot, description: 'Updated over the live API' };
    await request('bots/smoke-bot', 'PUT', bot);
    assert.equal((await request('bots')).find(b => b.id === 'smoke-bot').description, bot.description);
    assert.ok(Array.isArray(await request('usage')));
  });

  await t.test('workflow edit, manual run, cron schedule, validation and delete', async () => {
    const yaml = workflowToYaml({ name: 'smoke-workflow', bot: bot.id, prompt: 'Return a smoke result.', description: 'API test only' });
    await request('workflows/smoke-workflow', 'PUT', { yaml });
    assert.equal((await request('workflows/smoke-workflow')).yaml, yaml);
    faux.setResponses([fauxAssistantMessage('Workflow result')]);
    assert.equal((await request('workflows/smoke-workflow/run', 'POST')).text, 'Workflow result');
    const cron = workflowToYaml({ name: 'smoke-workflow', bot: bot.id, prompt: 'Briefing', cron: '0 9 1 1 *' });
    const scheduled = await request('workflows/smoke-workflow', 'PUT', { yaml: cron });
    assert.ok(scheduled.nextRuns['smoke-workflow']);
    await request('workflows/smoke-workflow', 'PUT', { yaml: 'name: [invalid' }, 500);
    assert.equal((await request('workflows/smoke-workflow')).yaml, cron, 'invalid edits must not overwrite saved YAML');
    const broken = path.join(home, 'workflows', 'broken.yaml');
    await writeFile(broken, 'name: [invalid');
    app.sb.reloadWorkflows();
    assert.ok((await request('workflows')).errors['broken.yaml']);
    await unlink(broken);
    await request('workflows/smoke-workflow', 'DELETE');
    assert.equal((await request('workflows')).workflows.length, 0);
  });

  await t.test('user skill and global/per-bot memory round trips', async () => {
    await request('skills/smoke-skill', 'PUT', { description: 'A smoke skill', body: '# Steps\nRead first.' });
    assert.equal((await request('skills/smoke-skill')).body, '# Steps\nRead first.');
    await request('skills/smoke-skill', 'PUT', { description: 'Updated description', body: 'Updated body.' });
    assert.equal((await request('skills/smoke-skill')).description, 'Updated description');
    assert.ok((await request('skills/reload', 'POST')).some(skill => skill.name === 'smoke-skill' && skill.source === 'user'));
    for (const route of ['memory', 'memory?bot=smoke-bot']) {
      await request(route, 'PUT', { text: `Memory for ${route}` });
      assert.equal((await request(route)).text, `Memory for ${route}`);
    }
  });

  await t.test('pairing and device registration/removal without sending push', async () => {
    const pair = await request('pair');
    assert.equal(pair.token, token);
    assert.equal(pair.host, '127.0.0.1');
    assert.ok(pair.urls.length > 0);
    await request('devices', 'POST', { name: 'Invalid', expoPushToken: 'invalid' }, 400);
    const device = await request('devices', 'POST', { name: 'Smoke phone', expoPushToken: 'ExpoPushToken[inert-smoke-token]' });
    assert.equal((await request('devices'))[0].name, 'Smoke phone');
    await request(`devices/${device.id}`, 'DELETE');
    assert.deepEqual(await request('devices'), []);
  });

  const messages = [];
  const waiting = new Set();
  function next(predicate) {
    const found = messages.findIndex(predicate);
    if (found !== -1) return Promise.resolve(messages.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const wait = { predicate, resolve(value) { clearTimeout(timer); waiting.delete(wait); resolve(value); } };
      const timer = setTimeout(() => { waiting.delete(wait); reject(new Error('Expected WebSocket event did not arrive')); }, 7000);
      waiting.add(wait);
    });
  }
  await t.test('WebSocket rejects invalid auth and sends hello/pong', async () => {
    const status = await new Promise(resolve => {
      const rejected = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=invalid`);
      rejected.on('unexpected-response', (_request, response) => { resolve(response.statusCode); rejected.terminate(); });
      rejected.on('error', () => {});
    });
    assert.equal(status, 401);
    socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`);
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      const wait = [...waiting].find(item => item.predicate(message));
      if (wait) wait.resolve(message); else messages.push(message);
    });
    assert.ok((await next(message => message.type === 'hello')).bots.some(b => b.id === bot.id));
    socket.send(JSON.stringify({ type: 'ping' }));
    assert.equal((await next(message => message.type === 'pong')).type, 'pong');
  });

  await t.test('WebSocket chat streams, persists, resets and reports unavailable models', async () => {
    faux.setResponses([fauxAssistantMessage('Hello from the smoke model')]);
    socket.send(JSON.stringify({ type: 'chat', id: 'smoke-chat', botId: bot.id, chatKey: 'web:smoke', text: 'Hello' }));
    const start = (await next(message => message.type === 'chat' && message.event.type === 'start' && message.event.chatKey === 'web:smoke')).event;
    assert.equal(start.botId, bot.id);
    const done = (await next(message => message.type === 'chat' && message.event.type === 'done' && message.event.runId === start.runId)).event;
    assert.equal(done.text, 'Hello from the smoke model');
    assert.equal(typeof done.inputTokens, 'number');
    assert.equal((await next(message => message.type === 'chat_result' && message.requestId === 'smoke-chat')).result.sessionId, start.sessionId);
    const transcript = await request('sessions?bot=smoke-bot&chat=web%3Asmoke');
    assert.deepEqual(transcript.messages.map(message => message.role), ['user', 'assistant']);
    assert.ok((await request('sessions/list?bot=smoke-bot')).some(session => session.chatKey === 'web:smoke'));
    await request('sessions/reset', 'POST', { botId: bot.id, chatKey: 'web:smoke' });
    assert.deepEqual((await request('sessions?bot=smoke-bot&chat=web%3Asmoke')).messages, []);
    await request('bots/smoke-bot', 'PUT', { ...bot, model: { provider: 'missing-provider', id: 'missing-model' } });
    socket.send(JSON.stringify({ type: 'chat', id: 'smoke-error', botId: bot.id, chatKey: 'web:smoke-error', text: 'No network should run' }));
    const failedStart = (await next(message => message.type === 'chat' && message.event.type === 'start' && message.event.chatKey === 'web:smoke-error')).event;
    assert.match((await next(message => message.type === 'chat' && message.event.type === 'error' && message.event.runId === failedStart.runId)).event.message, /not available/);
    assert.match((await next(message => message.type === 'chat_result' && message.requestId === 'smoke-error')).result.error, /not available/);
    socket.send(JSON.stringify({ type: 'abort', sessionId: start.sessionId }));
    assert.equal((await next(message => message.type === 'abort_result')).ok, false);
  });

  await t.test('approval notifications, REST decision, resolution and history', async () => {
    assert.equal(app.sb.config.devices.length, 0, 'never send a push to the inert device');
    const pending = app.sb.approvals.request({ botId: bot.id, botName: bot.name, chatKey: 'web:smoke', channel: 'web', toolName: 'write_file', category: 'write', summary: 'Smoke approval only; no tool executes', args: { path: 'smoke.txt', content: 'not executed' } });
    const requestMessage = await next(message => message.type === 'approval');
    assert.equal((await request('approvals')).length, 1);
    assert.equal((await request(`approvals/${requestMessage.request.id}`, 'POST', { decision: 'deny', by: 'web-smoke' })).ok, true);
    assert.equal((await pending).decision, 'deny');
    const resolved = await next(message => message.type === 'approval_resolved');
    assert.equal(resolved.resolved.id, requestMessage.request.id);
    assert.equal(resolved.resolved.decision, 'deny');
    assert.deepEqual(await request('approvals'), []);
    assert.equal((await request('approvals/log'))[0].decision, 'deny');
  });

  await t.test('bot delete leaves other bots available', async () => {
    await request('bots/smoke-bot', 'DELETE');
    const bots = await request('bots');
    assert.ok(!bots.some(b => b.id === bot.id));
    assert.ok(bots.some(b => b.id === 'guide'));
  });
});
