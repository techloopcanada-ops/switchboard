import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChatEvent, conversationKey } from '../src/chat-state.ts';

test('broadcast chat events remain scoped to run, bot and conversation', () => {
  let state = applyChatEvent({}, { type: 'start', runId: 'one', botId: 'coder', chatKey: 'web:one', sessionId: 's1' });
  state = applyChatEvent(state, { type: 'start', runId: 'two', botId: 'guide', chatKey: 'web:one', sessionId: 's2' });
  state = applyChatEvent(state, { type: 'delta', runId: 'one', text: 'Only coder' });
  state = applyChatEvent(state, { type: 'delta', runId: 'missing', text: 'Do not leak' });
  assert.equal(state[conversationKey('coder', 'web:one')].text, 'Only coder');
  assert.equal(state[conversationKey('guide', 'web:one')].text, '');
  state = applyChatEvent(state, { type: 'tool_start', runId: 'one', toolCallId: 't1', toolName: 'read_file', args: {} });
  state = applyChatEvent(state, { type: 'tool_end', runId: 'one', toolCallId: 't1', toolName: 'read_file', isError: false, output: 'read' });
  state = applyChatEvent(state, { type: 'done', runId: 'one', text: 'Finished', costUsd: .012, inputTokens: 10, outputTokens: 2 });
  assert.equal(state[conversationKey('coder', 'web:one')].tools[0].output, 'read');
  assert.equal(state[conversationKey('coder', 'web:one')].active, false);
  assert.equal(state[conversationKey('coder', 'web:one')].costUsd, .012);
  assert.equal(state[conversationKey('guide', 'web:one')].active, true);
});
test('stale events cannot overwrite a newer run in the same conversation', () => {
  const start = { type: 'start' as const, botId: 'coder', chatKey: 'web:one', sessionId: 's1' };
  let state = applyChatEvent({}, { ...start, runId: 'old' });
  state = applyChatEvent(state, { ...start, runId: 'new' });
  state = applyChatEvent(state, { type: 'error', runId: 'old', message: 'stale' });
  assert.equal(state[conversationKey('coder', 'web:one')].active, true);
  state = applyChatEvent(state, { type: 'error', runId: 'new', message: 'provider unavailable' });
  assert.equal(state[conversationKey('coder', 'web:one')].error, 'provider unavailable');
});
