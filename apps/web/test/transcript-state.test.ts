import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTranscript, messageText, shouldStickToBottom, toolSummary } from '../src/transcript-state.ts';
import type { Message } from '../src/types.ts';

test('stick-to-bottom includes the boundary, short pages and fractional scroll positions', () => {
  assert.equal(shouldStickToBottom({ scrollTop: 620, scrollHeight: 1000, clientHeight: 300 }), true);
  assert.equal(shouldStickToBottom({ scrollTop: 619.5, scrollHeight: 1000, clientHeight: 300 }), false);
  assert.equal(shouldStickToBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }), true);
  assert.equal(shouldStickToBottom({ scrollTop: 690, scrollHeight: 1000, clientHeight: 300 }, 5), false);
});

test('tool results join their calling assistant by id, including out-of-order results and errors', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Inspect the files.' },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking both.' }, { type: 'toolCall', id: 'a', name: 'read_file', arguments: { path: 'first.txt' } }, { type: 'toolCall', id: 'b', name: 'read_file', arguments: { path: 'second.txt' } }] },
    { role: 'toolResult', toolCallId: 'b', toolName: 'read_file', content: [{ type: 'text', text: 'Missing file' }], isError: true },
    { role: 'toolResult', toolCallId: 'a', toolName: 'read_file', content: [{ type: 'text', text: 'First contents' }], isError: false },
    { role: 'assistant', content: [{ type: 'text', text: 'One file was missing.' }] },
  ];
  const before = JSON.stringify(messages);
  const rows = groupTranscript(messages);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].tools[0].output, 'First contents');
  assert.equal(rows[1].tools[1].isError, true);
  assert.equal(rows[1].tools[1].output, 'Missing file');
  assert.equal(rows[1].retryText, 'Inspect the files.');
  assert.equal(rows[2].tools.length, 0);
  assert.equal(JSON.stringify(messages), before, 'render grouping must not mutate persisted messages');
});

test('orphan tool results stay visible and legacy results without an id match a pending tool', () => {
  const rows = groupTranscript([
    { role: 'toolResult', toolCallId: 'orphan', toolName: 'shell', content: 'failed', isError: true },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'list_dir', arguments: { path: '.' } }] },
    { role: 'toolResult', toolName: 'list_dir', content: 'hello.txt' },
  ]);
  assert.equal(rows[0].role, 'tool');
  assert.equal(rows[0].tools[0].isError, true);
  assert.equal(rows[1].tools[0].output, 'hello.txt');
  assert.equal(rows.length, 2);
});

test('each error retries its own user prompt, and summaries omit payload contents', () => {
  const rows = groupTranscript([{ role: 'user', content: 'First' }, { role: 'assistant', content: '', errorMessage: 'Failed' }, { role: 'user', content: 'Second' }, { role: 'assistant', content: '', errorMessage: 'Again' }]);
  assert.equal(rows[1].retryText, 'First');
  assert.equal(rows[3].retryText, 'Second');
  assert.equal(toolSummary({ path: 'hello.txt', content: 'Large or sensitive payload' }), 'hello.txt');
  assert.equal(toolSummary({ content: 'Large or sensitive payload' }), '');
  assert.equal(toolSummary({ command: 'echo\nhello' }), 'echo hello');
  assert.equal(messageText({ content: [{ type: 'text', text: 'hello' }, { type: 'toolCall', name: 'shell' }, { type: 'text', text: 'world' }] }), 'hello\nworld');
});
