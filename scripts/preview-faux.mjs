// Preview daemon for UI and device testing: the real Switchboard core with a scripted fake model, so chats,
// tool calls and approvals are deterministic and cost nothing. Never use your real ~/.switchboard for this:
// it creates its own throwaway home in the OS temp folder.
//
//   node scripts/preview-faux.mjs                 # listens on 0.0.0.0:7795 (reachable from the Android emulator at 10.0.2.2)
//   PREVIEW_PORT=7791 PREVIEW_HOST=127.0.0.1 node scripts/preview-faux.mjs
//
// Token (test only): ui-test-token-ui-test-token-1234. Exits by itself after 90 minutes.
// Message scripts: text containing "write" makes the bot call write_file (needs approval) and then reply with
// markdown; "long" returns a long reply that scrolls; anything else echoes. Requires `npm run build` first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PREVIEW_PORT ?? 7795);
const host = process.env.PREVIEW_HOST ?? '0.0.0.0';
const token = 'ui-test-token-ui-test-token-1234';
const home = fs.mkdtempSync(path.join(os.tmpdir(), `sb-preview-${port}-`));
process.env.SWITCHBOARD_HOME = home;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
  version: 1, server: { host, port }, token, providers: {},
  defaultModel: { provider: 'faux', id: 'faux-1' }, defaultBot: 'assistant', approvalTimeoutSec: 600, guideBot: true,
  learning: { auto: true, minToolCalls: 4 }, devices: [], workdir: path.join(home, 'workspace'), referralCodes: {},
}));

const pi = await import(pathToFileURL(path.join(repo, 'node_modules/@earendil-works/pi-ai/dist/index.js')).href);
const core = await import(pathToFileURL(path.join(repo, 'packages/core/dist/index.js')).href);
const faux = pi.fauxProvider({ provider: 'faux', models: [{ id: 'faux-1', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] });

const lastUser = ctx => {
  const m = [...ctx.messages].reverse().find(x => x.role === 'user');
  return typeof m?.content === 'string' ? m.content : (m?.content ?? []).map(c => c.text ?? '').join('');
};
const step = ctx => {
  console.log(`[preview] model call ${faux.state.callCount}`);
  const last = ctx.messages.at(-1);
  const said = lastUser(ctx);
  if (last?.role === 'toolResult') return pi.fauxAssistantMessage('Done. I wrote the file and checked it.\n\n```js\nconsole.log("hello from the test");\n```\n\n- first point\n- second point with `inline code`');
  if (/shell check/i.test(said)) return pi.fauxAssistantMessage([pi.fauxToolCall('shell', { command: 'echo preview' })]);
  if (/memory check/i.test(said)) return pi.fauxAssistantMessage([pi.fauxToolCall('remember', { note: 'Disposable preview memory.', scope: 'bot' })]);
  if (/write/i.test(said)) return pi.fauxAssistantMessage([pi.fauxToolCall('write_file', { path: 'note.txt', content: 'hello from the test' })]);
  if (/long/i.test(said)) return pi.fauxAssistantMessage(Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}: filler text so the conversation scrolls past one screen.`).join('\n\n'));
  return pi.fauxAssistantMessage(`You said: ${said}\n\nThis is a **scripted** reply from the test model.`);
};
faux.setResponses(Array.from({ length: 400 }, () => step));

const app = await core.startSwitchboard({ log: l => console.log('[preview]', l) });
app.sb.registry.models.setProvider(faux.provider);
console.log(`PREVIEW READY http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port} (emulator: http://10.0.2.2:${port}) token ${token}`);
setTimeout(() => app.stop().then(() => process.exit(0)), 90 * 60 * 1000);
