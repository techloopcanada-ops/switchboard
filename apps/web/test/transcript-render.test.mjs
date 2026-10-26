import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const generated = new URL(`.transcript-${process.pid}.mjs`, import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/Transcript.tsx', import.meta.url))], bundle: true, write: false, platform: 'node', packages: 'external', format: 'esm', jsx: 'automatic' });
await writeFile(generated, compiled.outputFiles[0].text);
const { default: Transcript } = await import(generated.href);
after(() => unlink(generated));
const render = props => renderToStaticMarkup(createElement(Transcript, { notify() {}, onRetry() {}, ...props }));
const usage = { input: 10, output: 20, cost: { total: 0.001 } };

test('only the final reply shows cost, and a completed run uses its aggregate total', () => {
  const html = render({ messages: [{ role: 'assistant', content: 'First', usage }, { role: 'user', content: 'Next' }, { role: 'assistant', content: 'Second', usage }], run: { active: false, runId: 'run', sessionId: 'session', text: 'Second', tools: [], costUsd: 0.42, inputTokens: 123, outputTokens: 45 } });
  assert.equal((html.match(/class="reply-usage"/g) ?? []).length, 1);
  assert.match(html, /\$0\.42000/);
  assert.match(html, /123 input \/ 45 output tokens/);
  assert.equal((html.match(/aria-label="Copy assistant message"/g) ?? []).length, 2);
});

test('live tools render arguments, output and errors, without stale cost while streaming', () => {
  const html = render({ messages: [{ role: 'assistant', content: 'Previous', usage }], run: { active: true, runId: 'run', sessionId: 'session', text: 'Working', tools: [{ id: 'one', name: 'read_file', args: { path: 'missing.txt' }, output: 'File missing', isError: true }] } });
  assert.doesNotMatch(html, /reply-usage/);
  assert.match(html, /class="tool-row error"/);
  assert.match(html, /missing.txt/);
  assert.match(html, /File missing/);
  assert.match(html, /<details/);
});
