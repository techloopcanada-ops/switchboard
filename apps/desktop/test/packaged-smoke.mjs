import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(directory, '..', 'release');
const executable = path.join(release, 'win-unpacked', 'Switchboard.exe');
assert.ok(fs.existsSync(executable), 'Build the desktop package before running its smoke test.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-packaged-smoke-'));
process.env.SWITCHBOARD_HOME = temporary;
const { defaultConfig, saveConfig } = await import('@switchboard/core');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function command(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => finish(new Error(`Debugger timed out: ${method}`)), 5000);
    function finish(error, result) {
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error); else resolve(result);
    }
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onerror = () => finish(new Error(`Debugger failed: ${method}`));
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) finish(message.error ? new Error(message.error.message) : undefined, message.result);
    };
  });
}

const port = await freePort();
const debugPort = await freePort();
const config = { ...defaultConfig(), server: { host: '127.0.0.1', port } };
saveConfig(config);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [
  `--user-data-dir=${path.join(temporary, 'electron')}`,
  `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
let spawnError;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => resolve({ code, signal }));
  child.once('error', error => { spawnError = error; resolve({ code: null, signal: null }); });
});
let rendererReady = false;
let checksPassed = false;
let failure;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Packaged app exited early: ${output}`);
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(500) }).then(response => response.json());
      const page = pages.find(candidate => candidate.type === 'page' && new URL(candidate.url).origin === `http://127.0.0.1:${port}`);
      if (page) {
        const result = await command(page.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
        const text = result.result?.value;
        if (!result.exceptionDetails && typeof text === 'string' && /Settings/.test(text) && /Chat/.test(text)) {
          rendererReady = true;
          break;
        }
      }
    } catch { /* Wait for the packaged daemon and renderer to become ready. */ }
    await pause(300);
  }
  assert.ok(rendererReady, `Packaged UI did not load. ${output}`);
  const response = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { Authorization: `Bearer ${config.token}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, '0.1.0');
  const skills = await fetch(`http://127.0.0.1:${port}/api/skills`, { headers: { Authorization: `Bearer ${config.token}` } }).then(response => response.json());
  assert.ok(skills.some(skill => skill.source === 'bundled'));
  checksPassed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    const browser = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) }).then(response => response.json());
    await command(browser.webSocketDebuggerUrl, 'Browser.close');
  } catch { /* Fall through to isolated test-process cleanup. */ }
  let exitResult = await Promise.race([exited, pause(5000).then(() => undefined)]);
  const gracefulExit = Boolean(exitResult && !spawnError && exitResult.code === 0 && exitResult.signal === null);
  if (!exitResult) { child.kill(); exitResult = await exited; }
  const passed = checksPassed && gracefulExit;
  const { code: exitCode, signal: exitSignal } = exitResult;
  fs.writeFileSync(path.join(release, 'packaged-smoke-results.json'), JSON.stringify({ passed, rendererReady, gracefulExit, exitCode, exitSignal, temporary }, null, 2));
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('switchboard-packaged-smoke-'));
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Windows may retain test cache handles. */ }
  if (failure) throw failure;
  assert.ok(gracefulExit, `Packaged app did not exit cleanly before the timeout (code ${exitCode}, signal ${exitSignal}). ${output}`);
  console.log('Packaged executable smoke passed: real daemon, rendered UI, bundled skills, and clean exit.');
}
