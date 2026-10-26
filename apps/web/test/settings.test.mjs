import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { test, after } from 'node:test';
import { transform } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const generated = new URL(`.model-picker-${process.pid}.mjs`, import.meta.url);
const source = await readFile(new URL('../src/model-picker.tsx', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'tsx', jsx: 'automatic', format: 'esm' });
await writeFile(generated, compiled.code);
const { default: ModelPicker } = await import(generated.href);
after(() => unlink(generated));
const providers = [
  { id: 'first', name: 'First', kind: 'builtin', configured: true, models: [{ id: 'first-model', name: 'First model' }] },
  { id: 'second', name: 'Second', kind: 'builtin', configured: true, models: [{ id: 'second-model', name: 'Second model' }] },
  { id: 'local', name: 'Local', kind: 'openai-compatible', configured: true, models: [] },
];
const render = value => renderToStaticMarkup(createElement(ModelPicker, { providers, value, onChange() {} }));

test('model picker lists only models for the selected provider', () => {
  const html = render({ provider: 'first', id: 'first-model' });
  assert.match(html, /first-model/);
  assert.doesNotMatch(html, /second-model/);
});

test('custom providers accept a model ID when discovery returns no models', () => {
  const html = render({ provider: 'local', id: 'my-local-model' });
  assert.match(html, /<input[^>]+value="my-local-model"/);
  assert.match(html, /Use the exact ID/);
});

test('existing unknown provider and model remain visible instead of silently changing', () => {
  const html = render({ provider: 'missing', id: 'saved-model' });
  assert.match(html, /missing \(unavailable\)/);
  assert.match(html, /saved-model \(not in catalog\)/);
  assert.equal((html.match(/selected=""/g) ?? []).length, 2);
});
