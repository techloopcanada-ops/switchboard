import test from 'node:test';
import assert from 'node:assert/strict';
import { canClearSentDraft, finishDraftRun, sameChat, serialQueue, type SentDraft } from '../src/chat-state.ts';

test('old run completion preserves a newer queued message until its own acknowledgement', () => {
  const target = { botId: 'assistant', chatKey: 'mobile:test' };
  const queued: SentDraft = { ...target, id: 'new-request', text: 'next message', revision: 2, accepted: false };
  const oldRun = finishDraftRun(queued, 'before-reconnect');
  assert.equal(oldRun.completed, null);
  assert.equal(oldRun.pending, queued);
  assert.equal(canClearSentDraft(oldRun.pending!, target, 'next message', 2), true);

  queued.runId = 'new-run';
  queued.accepted = true;
  assert.equal(finishDraftRun(queued, 'unrelated-run').pending, queued);
  assert.deepEqual(finishDraftRun(queued, 'new-run'), { pending: null, completed: queued });
  assert.deepEqual(finishDraftRun(null, 'before-reconnect'), { pending: null, completed: null });
});

test('acknowledgements preserve edits, other bots and repeated identical drafts', () => {
  const target = { botId: 'assistant', chatKey: 'mobile:test' };
  const request = { ...target, id: '1', text: 'hello', revision: 1, accepted: false };
  assert.equal(canClearSentDraft(request, target, 'hello', 1), true);
  assert.equal(canClearSentDraft(request, target, 'new draft', 2), false);
  assert.equal(canClearSentDraft(request, target, 'hello', 2), false);
  assert.equal(canClearSentDraft({ ...request, accepted: true }, target, 'hello', 1), false);
  assert.equal(sameChat(target, { ...target, botId: 'coder' }), false);
  assert.equal(canClearSentDraft(request, { ...target, chatKey: 'mobile:other' }, 'hello', 1), false);
});

test('serialized draft writes cannot finish out of order and recover after failure', async () => {
  const enqueue = serialQueue();
  const writes: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = enqueue(async () => { await blocked; writes.push('first chat'); });
  const failed = enqueue(async () => { throw new Error('disk full'); });
  const failure = assert.rejects(failed, /disk full/);
  const last = enqueue(async () => { writes.push('new draft'); });
  await Promise.resolve();
  assert.deepEqual(writes, []);
  release();
  await Promise.all([first, failure, last]);
  assert.deepEqual(writes, ['first chat', 'new draft']);
});
