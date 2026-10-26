import assert from 'node:assert/strict';
import test from 'node:test';
import { createApprovalSnapshots } from '../src/approval-snapshots.ts';
import type { ApprovalRequest } from '../src/types.ts';

const request = (id: string): ApprovalRequest => ({ id, botId: 'coder', botName: 'Coder', chatKey: 'web:one', channel: 'web', toolName: 'write_file', category: 'write', summary: id, args: {}, createdAt: 0, expiresAt: 1000 });
function deferred() {
  let resolve!: (requests: ApprovalRequest[]) => void;
  const promise = new Promise<ApprovalRequest[]>(done => { resolve = done; });
  return { promise, resolve };
}

test('delayed startup snapshot cannot erase a newer live approval', async () => {
  const snapshots = createApprovalSnapshots();
  const response = deferred();
  let visible: ApprovalRequest[] = [];
  const loading = snapshots.refresh(() => response.promise, requests => { visible = requests; });
  snapshots.invalidate();
  visible = [request('new-live')];
  response.resolve([]);
  await loading;
  assert.deepEqual(visible.map(item => item.id), ['new-live']);
});

test('delayed refresh cannot resurrect a resolved approval', async () => {
  const snapshots = createApprovalSnapshots();
  const response = deferred();
  let visible = [request('resolved')];
  const loading = snapshots.refresh(() => response.promise, requests => { visible = requests; });
  snapshots.invalidate();
  visible = [];
  response.resolve([request('resolved')]);
  await loading;
  assert.deepEqual(visible, []);
});

test('newest requested snapshot wins even when responses arrive out of order', async () => {
  const snapshots = createApprovalSnapshots();
  const older = deferred();
  let visible: ApprovalRequest[] = [];
  const stale = snapshots.refresh(() => older.promise, requests => { visible = requests; });
  await snapshots.refresh(async () => [request('current')], requests => { visible = requests; });
  older.resolve([request('old')]);
  await stale;
  assert.deepEqual(visible.map(item => item.id), ['current']);
});

test('cleanup invalidates in-flight reads and load errors still propagate', async () => {
  const snapshots = createApprovalSnapshots();
  const response = deferred();
  let applied = false;
  const pending = snapshots.refresh(() => response.promise, () => { applied = true; });
  snapshots.invalidate();
  response.resolve([]);
  await pending;
  assert.equal(applied, false);
  await assert.rejects(snapshots.refresh(async () => { throw new Error('offline'); }, () => {}), /offline/);
});
