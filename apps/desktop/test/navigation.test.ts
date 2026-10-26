import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExternalWebUrl, isSameOrigin } from '../navigation.ts';

test('only the daemon origin stays inside Electron', () => {
  const origin = 'http://127.0.0.1:7787';
  assert.equal(isSameOrigin(`${origin}/#/approvals`, origin), true);
  for (const url of ['http://127.0.0.1:7788', 'https://127.0.0.1:7787', 'http://127.0.0.1.evil.test:7787', 'file:///C:/secret', 'invalid']) {
    assert.equal(isSameOrigin(url, origin), false);
  }
});

test('external links reject operating system handlers and embedded credentials', () => {
  assert.equal(isExternalWebUrl('https://example.com/docs'), true);
  assert.equal(isExternalWebUrl('http://localhost:11434'), true);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'switchboard://pair', 'https://user:password@example.com', 'invalid']) {
    assert.equal(isExternalWebUrl(url), false);
  }
});
