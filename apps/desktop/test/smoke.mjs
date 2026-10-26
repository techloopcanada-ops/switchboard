import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog } from 'electron';

const directory = path.dirname(fileURLToPath(import.meta.url));
const resultFile = path.resolve(directory, '..', 'release', 'smoke-results.json');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-desktop-smoke-'));
const errors = [];
const persistence = { seeded: false, draftTyped: false, closeReopen: false, reload: false };
let appIdentity;
const setAppIdentity = app.setAppUserModelId.bind(app);
app.setAppUserModelId = id => { appIdentity = id; setAppIdentity(id); };
let passed = false;
let checksPassed = false;
let shutdownTimer;
process.env.SWITCHBOARD_HOME = temporary;
app.setPath('userData', path.join(temporary, 'electron'));
dialog.showErrorBox = (title, message) => errors.push(`${title}: ${message}`);
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_gone, details) => errors.push(`Renderer exited: ${details.reason}`));
  contents.on('did-fail-load', (_failed, code, message) => errors.push(`Load failed ${code}: ${message}`));
  contents.on('console-message', details => {
    if (details.level === 'error') errors.push(details.message);
  });
});
app.on('will-quit', () => {
  clearTimeout(shutdownTimer);
  passed = checksPassed && errors.length === 0;
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify({ passed, errors, temporary, appIdentity, persistence }, null, 2));
  // Windows may retain Chromium cache handles until the process exits.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('switchboard-desktop-smoke-'));
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Test data only. */ }
  if (passed) console.log('Desktop smoke passed: real daemon/UI, isolated profile, typed draft + current conversation survive native close/reopen and renderer reload, matching Windows app identity, clean shutdown.');
  if (!passed) app.exit(1);
});

// Electron waits for the entry module to finish before emitting ready.
void (async () => { try {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const { defaultConfig, saveConfig } = await import('@switchboard/core');
  const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const model = { provider: 'desktop-test', id: 'persistence-fixture' };
  saveConfig({ ...defaultConfig(), defaultModel: model, learning: { auto: false, minToolCalls: 2 }, server: { host: '127.0.0.1', port } });
  const { ready } = await import('../dist/main.js');
  const daemon = await ready;
  assert.ok(daemon);
  assert.notEqual(port, 7787);
  assert.equal(app.getPath('userData'), path.join(temporary, 'electron'));
  assert.equal(daemon.sb.config.workdir, path.join(temporary, 'workspace'));
  const builderId = /^appId:\s*(\S+)/m.exec(fs.readFileSync(path.resolve(directory, '..', 'electron-builder.yml'), 'utf8'))?.[1];
  assert.equal(appIdentity, builderId, 'Windows notification identity must match the installer shortcut');
  const faux = fauxProvider({ provider: model.provider, tokensPerSecond: 1000, models: [{ id: model.id }] });
  faux.setResponses([fauxAssistantMessage('This conversation is saved by the local Electron test model.')]);
  daemon.sb.registry.models.setProvider(faux.provider);
  const window = BrowserWindow.getAllWindows()[0];
  assert.ok(window);
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  async function waitFor(expression, description) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await window.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    throw new Error(`Timed out waiting for ${description}`);
  }
  let text = '';
  for (let i = 0; i < 60; i++) {
    text = await window.webContents.executeJavaScript('document.body.innerText');
    if (/Settings/i.test(text) && /Chat/i.test(text)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.match(text, /Settings/i);
  assert.match(text, /Chat/i);
  assert.match(window.webContents.getURL(), new RegExp(`127\\.0\\.0\\.1:${port}`));
  const status = await fetch(`${daemon.url}/api/status`, { headers: { Authorization: `Bearer ${daemon.sb.config.token}` } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).version, '0.1.0');
  const conversation = { botId: 'assistant', chatKey: 'web:electron-persistence-fixture' };
  const title = 'Electron persistence fixture';
  const draft = 'Unsent Electron draft — first line\nSecond line must survive closing the window.';
  const result = await daemon.sb.chat({ ...conversation, channel: 'web', text: title });
  assert.equal(result.error, undefined);
  assert.equal(faux.state.callCount, 1);
  persistence.seeded = true;
  await waitFor(`Array.from(document.querySelectorAll('.conversation-select')).some(button => button.textContent.includes(${JSON.stringify(title)}))`, 'the saved conversation row');
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.conversation-select')).find(button => button.textContent.includes(${JSON.stringify(title)})).click()`);
  await waitFor(`localStorage.getItem('switchboard.current') === ${JSON.stringify(JSON.stringify(conversation))} && document.querySelector('.conversation-title')?.textContent === ${JSON.stringify(title)}`, 'the selected conversation');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('chat-message');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(draft)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const persisted = `document.getElementById('chat-message')?.value === ${JSON.stringify(draft)} && localStorage.getItem('switchboard.current') === ${JSON.stringify(JSON.stringify(conversation))} && localStorage.getItem(${JSON.stringify(`switchboard.draft:${JSON.stringify([conversation.botId, conversation.chatKey])}`)}) === ${JSON.stringify(draft)}`;
  await waitFor(persisted, 'the typed draft to reach React and localStorage');
  persistence.draftTyped = true;
  const savedConfig = JSON.stringify(daemon.sb.config);
  await daemon.pauseChannels();
  assert.equal(daemon.channelsPaused(), true);
  assert.deepEqual(daemon.sb.channelIds(), []);
  await daemon.resumeChannels();
  assert.equal(daemon.channelsPaused(), false);
  assert.equal(JSON.stringify(daemon.sb.config), savedConfig);
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  app.emit('activate');
  assert.equal(window.isVisible(), true);
  await waitFor(persisted, 'conversation and draft after native window close/reopen');
  persistence.closeReopen = true;
  window.webContents.reload();
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  await waitFor(persisted, 'conversation and draft after a fresh renderer load');
  persistence.reload = true;
  assert.equal(faux.state.callCount, 1, 'reopening and reloading must not send the draft');
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(path.resolve(directory, '..', 'release', 'electron-persistence.png'), (await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  const unfinished = http.request(`${daemon.url}/api/config`, {
    method: 'PUT', headers: { Authorization: `Bearer ${daemon.sb.config.token}` },
  });
  unfinished.on('error', () => {});
  unfinished.write('{');
  await new Promise(resolve => setTimeout(resolve, 50));
  checksPassed = true;
  shutdownTimer = setTimeout(() => {
    errors.push('Quit did not finish within 10 seconds.');
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify({ passed: false, errors, temporary }, null, 2));
    app.exit(1);
  }, 10_000);
  app.quit();
  app.quit();
} catch (error) {
  errors.push(error.stack ?? String(error));
  console.error(error);
  app.quit();
} })();
