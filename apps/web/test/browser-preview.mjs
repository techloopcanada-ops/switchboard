// Real daemon with a repeatable local model. All data and approved writes stay in a disposable home.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-browser-preview-'));
process.env.SWITCHBOARD_HOME = temporary;
const { defaultConfig, saveConfig, startSwitchboard } = await import('../../../packages/core/dist/index.js');
const model = { provider: 'preview', id: 'local-test-model' };
saveConfig({ ...defaultConfig(), defaultModel: model, learning: { auto: false, minToolCalls: 2 }, server: { host: '127.0.0.1', port: 7791 } });
const daemon = await startSwitchboard();
const faux = fauxProvider({ provider: model.provider, tokensPerSecond: 200, tokenSize: { min: 3, max: 3 }, models: [{ id: model.id, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
daemon.sb.registry.models.setProvider(faux.provider);

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
function respond(context) {
  faux.appendResponses([respond]);
  if (context.messages.some(message => message.role === 'system' && JSON.stringify(message).includes('You review a finished conversation'))) {
    return fauxAssistantMessage(JSON.stringify({ save: true, name: 'preview-approved-write', description: 'Write and verify a small file in the approved workspace.', body: '1. Confirm the requested file name and content.\n2. Use write_file and wait for the user to approve it.\n3. Read the file back to verify the content.\n4. Report the result and stop if the user denies the write.' }));
  }
  const last = context.messages.at(-1);
  const prompt = textOf([...context.messages].reverse().find(message => message.role === 'user')?.content);
  if (last?.role === 'toolResult') return fauxAssistantMessage(last.isError
    ? 'The file was not written. Your decision was respected. You can retry when ready.'
    : '## Task complete\n\nCreated **browser-check.txt** after the write was allowed.\n\n- The file stayed in the isolated test workspace.\n- Your decision is listed in Approvals.\n\n```javascript\nconsole.log("Hello, Switchboard!");\n```\n\nThis response came from a local test model.');
  if (/fixture error/i.test(prompt)) return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Preview model failed on purpose. Retry with another message.' });
  if (/\b(write|file|approval)\b/i.test(prompt)) return fauxAssistantMessage([
    fauxText('I will write a small file in this isolated workspace. '),
    fauxToolCall('write_file', { path: 'browser-check.txt', content: `Approved local preview write.\nRequest: ${prompt}\n` }),
  ]);
  return fauxAssistantMessage('Hello from the **local preview model**.\n\nYou said: ' + prompt + '\n\nTry “write a file” with Coder to test inline approvals, or type /help for local commands.\n\n```text\nNo provider key or paid model was used.\n```');
}
faux.setResponses([respond]);

const api = async (route, body) => {
  const response = await fetch(`${daemon.url}/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${daemon.sb.config.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
  return response.json();
};
await api('status');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closing = daemon.stop();
  daemon.server.server.closeAllConnections();
  await closing;
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('switchboard-browser-preview-'));
  fs.rmSync(temporary, { recursive: true, force: true });
}
process.on('SIGINT', () => void stop().then(() => process.exit()));
process.on('SIGTERM', () => void stop().then(() => process.exit()));

async function selfTest() {
  const chat = text => api('chat', { botId: 'coder', chatKey: 'web:preview-self-test', text });
  const command = await chat('/bot coder');
  assert.equal(command.command.switchBot, 'coder');
  assert.equal(faux.state.callCount, 0, 'slash commands must not call the model');
  assert.equal((await api('sessions/list')).length, 0, 'slash commands must not create sessions');
  for (const remember of [false, true]) {
    const pending = once(daemon.sb, 'approval', { signal: AbortSignal.timeout(15_000) });
    const result = chat(`write a file ${remember ? 'and remember the policy' : 'once'}`);
    const [request] = await pending;
    assert.equal(request.toolName, 'write_file');
    await api(`approvals/${request.id}`, { decision: 'allow', remember, by: 'preview-self-test' });
    assert.match((await result).text, /Task complete/);
    assert.equal(daemon.sb.getBot('coder').policy.write ?? 'ask', remember ? 'auto' : 'ask');
  }
  let approvalCount = 0;
  const count = () => { approvalCount++; };
  daemon.sb.on('approval', count);
  assert.match((await chat('write another file')).text, /Task complete/);
  daemon.sb.off('approval', count);
  assert.equal(approvalCount, 0, 'Always allow must skip the next write approval');
  assert.match(fs.readFileSync(path.join(temporary, 'workspace', 'browser-check.txt'), 'utf8'), /write another file/);
  const history = await api('sessions?bot=coder&chat=web%3Apreview-self-test');
  assert.ok(history.messages.some(message => message.role === 'toolResult' && message.toolCallId));
  const learning = await api('learn', { botId: 'coder', chatKey: 'web:preview-self-test' });
  assert.equal(learning.proposed.name, 'preview-approved-write');
  const suggestion = (await api('approvals')).find(request => request.toolName === 'save_skill');
  assert.ok(suggestion);
  const learned = once(daemon.sb, 'skill_learned', { signal: AbortSignal.timeout(15_000) });
  await api(`approvals/${suggestion.id}`, { decision: 'allow', by: 'preview-self-test' });
  assert.equal((await learned)[0], 'preview-approved-write');
  assert.ok((await api('skills')).some(skill => skill.name === 'preview-approved-write'));
  console.log('PASS preview self-test: local commands, repeated writes, Allow, Always allow, persisted tools, skill suggestion/save.');
}

if (process.argv.includes('--self-test')) {
  try { await selfTest(); } finally { await stop(); }
} else {
  console.log(`Browser fixture ready: ${daemon.url}/#/chat`);
  console.log('Use /bot coder, then “write a file” repeatedly for Allow / Always allow. Use /learn for a suggested skill, or “fixture error” for Retry. Ctrl+C removes the isolated data.');
}
