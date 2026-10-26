// Isolated browser fixture: real daemon, deterministic local model, no API keys or external channels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-browser-preview-'));
process.env.SWITCHBOARD_HOME = temporary;
const { defaultConfig, saveConfig, startSwitchboard } = await import('../../../packages/core/dist/index.js');
const model = { provider: 'preview', id: 'local-test-model' };
saveConfig({ ...defaultConfig(), defaultModel: model, server: { host: '127.0.0.1', port: 7791 } });
const daemon = await startSwitchboard();
const faux = fauxProvider({ provider: model.provider, models: [{ id: model.id, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });
daemon.sb.registry.models.setProvider(faux.provider);
faux.setResponses([
  fauxAssistantMessage([fauxToolCall('write_file', { path: 'browser-check.txt', content: 'This file was approved in the isolated browser check.' })]),
  fauxAssistantMessage('## Task complete\n\nCreated **browser-check.txt** after your approval.\n\n- The write stayed in the test workspace.\n- Your decision is in Approvals.\n\n```text\nThis is a local test response; no paid model was used.\n```'),
]);
assert.equal((await fetch(`${daemon.url}/api/status`, { headers: { Authorization: `Bearer ${daemon.sb.config.token}` } })).status, 200);
console.log('Browser fixture ready: ' + daemon.url + '/#/chat — choose Coder and send a message.');
async function stop() {
  const closing = daemon.stop();
  daemon.server.server.closeAllConnections();
  await closing;
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('switchboard-browser-preview-'));
  fs.rmSync(temporary, { recursive: true, force: true });
  process.exit();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
