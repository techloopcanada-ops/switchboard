import assert from 'node:assert/strict';
import test from 'node:test';
import { createApprovalState } from '../src/approval-state.ts';
import type { Approval } from '../src/connection.ts';

const request = (id: string): Approval => ({ id, botId: 'coder', botName: 'Coder', chatKey: 'phone:one', channel: 'web', toolName: 'write_file', category: 'write', summary: id, args: {}, createdAt: 0, expiresAt: 1000 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup() {
  let visible: Approval[] = [];
  const state = createApprovalState(next => { visible = next; });
  return { state, ids: () => visible.map(item => item.id) };
}

test('failed decision remains visible and can be retried after confirmation', async () => {
  const { state, ids } = setup();
  state.add(request('pending'));
  const response = deferred<{ ok: boolean }>();
  const deciding = state.decide('pending', () => response.promise);
  assert.deepEqual(ids(), ['pending']);
  response.reject(new Error('Network request failed'));
  await assert.rejects(deciding, /Network request failed/);
  assert.deepEqual(ids(), ['pending']);
  assert.equal(await state.decide('pending', async () => ({ ok: true })), true);
  assert.deepEqual(ids(), []);
});

test('duplicate taps share one request and wait for its confirmation', async () => {
  const { state, ids } = setup();
  const response = deferred<{ ok: boolean }>();
  state.add(request('pending'));
  let calls = 0;
  const first = state.decide('pending', () => { calls++; return response.promise; });
  const second = state.decide('pending', async () => { calls++; return { ok: false }; });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(ids(), ['pending']);
  response.resolve({ ok: true });
  await first;
  assert.deepEqual(ids(), []);
});

test('a confirmed expired request is removed, but an invalid response is retained', async () => {
  const { state, ids } = setup();
  state.add(request('expired'));
  assert.equal(await state.decide('expired', async () => ({ ok: false })), false);
  state.add(request('pending'));
  await assert.rejects(state.decide('pending', async () => ({} as { ok: boolean })), /did not confirm/);
  assert.deepEqual(ids(), ['pending']);
});

test('a delayed foreground snapshot cannot erase a newer live approval', async () => {
  const { state, ids } = setup();
  const response = deferred<Approval[]>();
  const loading = state.refresh(() => response.promise);
  state.add(request('new-live'));
  response.resolve([]);
  await loading;
  assert.deepEqual(ids(), ['new-live']);
});

test('a delayed snapshot or reconnect hello cannot resurrect a resolved approval', async () => {
  const { state, ids } = setup();
  const pending = request('pending');
  state.replace([pending]);
  const response = deferred<Approval[]>();
  const loading = state.refresh(() => response.promise);
  state.remove(pending.id);
  response.resolve([pending]);
  await loading;
  state.replace([pending, request('still-waiting')]);
  assert.deepEqual(ids(), ['still-waiting']);
});

test('confirmed POST invalidates a foreground read even without a socket event', async () => {
  const { state, ids } = setup();
  const pending = request('pending');
  state.add(pending);
  const response = deferred<Approval[]>();
  const loading = state.refresh(() => response.promise);
  await state.decide(pending.id, async () => ({ ok: true }));
  response.resolve([pending]);
  await loading;
  assert.deepEqual(ids(), []);
});

test('failed POST does not restore a request already resolved by the live socket', async () => {
  const { state, ids } = setup();
  state.add(request('pending'));
  const response = deferred<{ ok: boolean }>();
  const deciding = state.decide('pending', () => response.promise);
  state.remove('pending');
  response.reject(new Error('Connection dropped after server response'));
  await assert.rejects(deciding, /Connection dropped/);
  assert.deepEqual(ids(), []);
});

test('latest foreground read wins when responses arrive out of order', async () => {
  const { state, ids } = setup();
  const response = deferred<Approval[]>();
  const stale = state.refresh(() => response.promise);
  await state.refresh(async () => [request('current')]);
  response.resolve([request('old')]);
  await stale;
  assert.deepEqual(ids(), ['current']);
  await assert.rejects(state.refresh(async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(ids(), ['current']);
});

test('old connection reads, events and decisions cannot update a new connection', async () => {
  const { state, ids } = setup();
  state.add(request('old-connection'));
  const snapshot = deferred<Approval[]>();
  const decision = deferred<{ ok: boolean }>();
  const loading = state.refresh(() => snapshot.promise);
  const deciding = state.decide('old-connection', () => decision.promise);
  const before = ids();
  state.close();
  snapshot.resolve([request('stale-snapshot')]);
  decision.resolve({ ok: true });
  state.add(request('stale-event'));
  state.replace([]);
  await loading;
  assert.equal(await deciding, undefined);
  assert.equal(await state.decide('unpaired', async () => { assert.fail('must not send after unpair'); }), undefined);
  assert.deepEqual(ids(), before);
});
