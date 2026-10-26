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
  fs.writeFileSync(resultFile, JSON.stringify({ passed, errors, temporary }, null, 2));
  // Windows may retain Chromium cache handles until the process exits.
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Test data only. */ }
  if (passed) console.log('Desktop smoke passed: real daemon/UI, isolated renderer, tray close, clean shutdown with an unfinished HTTP request.');
  if (!passed) app.exit(1);
});

// Electron waits for the entry module to finish before emitting ready.
void (async () => { try {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const { defaultConfig, saveConfig } = await import('@switchboard/core');
  saveConfig({ ...defaultConfig(), server: { host: '127.0.0.1', port } });
  const { ready } = await import('../dist/main.js');
  const daemon = await ready;
  assert.ok(daemon);
  const window = BrowserWindow.getAllWindows()[0];
  assert.ok(window);
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
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
