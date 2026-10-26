import assert from 'node:assert/strict';
import test from 'node:test';
import { newId } from '../src/id.ts';
test('conversation ids work on LAN HTTP without crypto.randomUUID', () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: original.getRandomValues.bind(original) } });
  try {
    assert.match(newId(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.notEqual(newId(), newId());
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original }); }
});
