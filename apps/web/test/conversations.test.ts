import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDraft, filterConversations, filterUnsentDrafts, formatCountdown, groupConversations, listDrafts, loadCurrent, loadDraft, saveCurrent, saveDraft } from '../src/conversations.ts';
import type { SessionRow } from '../src/types.ts';

function storage() {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; }, getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); }, removeItem(key: string) { values.delete(key); } };
}
const fallback = { botId: 'assistant', chatKey: 'web:new' };
function row(id: string, updatedAt: number, title = id, preview = ''): SessionRow {
  return { id, botId: 'coder', chatKey: `web:${id}`, channel: 'web', title, preview, createdAt: updatedAt, updatedAt, messageCount: 2 };
}

test('current conversation survives reload and malformed storage falls back', () => {
  const store = storage();
  const current = { botId: 'coder', chatKey: 'web:existing' };
  assert.deepEqual(loadCurrent(store, fallback), fallback);
  saveCurrent(store, current);
  assert.deepEqual(loadCurrent(store, fallback), current);
  for (const broken of ['{', 'null', '[]', '12', '{"botId":"coder"}', '{"botId":" ","chatKey":"web:x"}', '{"botId":"coder","chatKey":5}']) {
    store.values.set('switchboard.current', broken);
    assert.deepEqual(loadCurrent(store, fallback), fallback);
  }
});

test('drafts are exact and isolated by bot as well as conversation', () => {
  const store = storage();
  const a = { botId: 'coder', chatKey: 'web:one' };
  const b = { botId: 'assistant', chatKey: 'web:one' };
  const c = { botId: 'coder', chatKey: 'web:two' };
  saveDraft(store, a, 'Line one\n  unfinished 日本語');
  saveDraft(store, b, 'Assistant draft');
  saveDraft(store, c, 'Other conversation');
  assert.equal(loadDraft(store, a), 'Line one\n  unfinished 日本語');
  assert.equal(loadDraft(store, b), 'Assistant draft');
  clearDraft(store, a);
  assert.equal(loadDraft(store, a), '');
  assert.equal(loadDraft(store, c), 'Other conversation');
  saveDraft(store, c, '');
  assert.equal(loadDraft(store, c), '');
  assert.equal(store.values.size, 1);
});

test('unavailable or full storage never breaks current selection or typing', () => {
  const broken = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); }, removeItem() { throw new Error('Denied'); } };
  const getters = { get getItem(): Storage['getItem'] { throw new Error('Denied getter'); }, get setItem(): Storage['setItem'] { throw new Error('Denied getter'); }, get removeItem(): Storage['removeItem'] { throw new Error('Denied getter'); } };
  for (const store of [null, undefined, broken, getters]) {
    assert.deepEqual(loadCurrent(store, fallback), fallback);
    assert.equal(loadDraft(store, fallback), '');
    assert.doesNotThrow(() => saveCurrent(store, fallback));
    assert.doesNotThrow(() => saveDraft(store, fallback, 'keep typing'));
    assert.doesNotThrow(() => clearDraft(store, fallback));
    assert.deepEqual(listDrafts(store), []);
  }
});

test('unsent drafts can be listed across bots without a server session', () => {
  const store = storage();
  const a = { botId: 'coder', chatKey: 'web:unsent-one' };
  const b = { botId: 'assistant', chatKey: 'web:unsent-two' };
  saveDraft(store, a, 'First unsent\n  exact draft');
  saveDraft(store, b, 'Second unsent draft');
  saveCurrent(store, a);
  saveDraft(store, { botId: 'coder', chatKey: 'web:blank' }, '  \n');
  store.values.set('switchboard.draft:{broken', 'damaged');
  store.values.set('switchboard.draft:["coder",3]', 'invalid key');
  store.values.set('unrelated', 'not a draft');
  assert.deepEqual(listDrafts(store), [{ ...a, text: 'First unsent\n  exact draft' }, { ...b, text: 'Second unsent draft' }]);
  clearDraft(store, a);
  assert.deepEqual(listDrafts(store), [{ ...b, text: 'Second unsent draft' }]);
});

test('draft listing tolerates blocked storage enumeration', () => {
  const store = storage();
  saveDraft(store, fallback, 'Saved draft');
  const blockedKey = { ...store, key() { throw new Error('Denied'); } };
  const blockedLength = { ...store, get length(): number { throw new Error('Denied'); } };
  assert.deepEqual(listDrafts(blockedKey), []);
  assert.deepEqual(listDrafts(blockedLength), []);
});

test('drafts are not offered as empty chats before the server session list arrives', () => {
  const existing = { botId: 'coder', chatKey: 'web:existing', text: 'Unsent follow-up to an existing chat' };
  const fresh = { botId: 'assistant', chatKey: 'web:fresh', text: 'First message draft' };
  const drafts = [existing, fresh];
  assert.deepEqual(filterUnsentDrafts(drafts, undefined), [], 'an unresolved or failed list must not classify existing chats as new');
  assert.deepEqual(filterUnsentDrafts(drafts, [row('existing', 1)]), [fresh]);
  assert.deepEqual(filterUnsentDrafts(drafts, []), drafts, 'a successful empty list permits local draft-only chats');
  assert.deepEqual(drafts, [existing, fresh], 'classification must preserve the original drafts');
});

test('groups use local calendar boundaries and newest-first order without mutating input', () => {
  const now = new Date(2026, 9, 25, 0, 5);
  const rows = [row('old', new Date(2026, 9, 17, 23, 59).getTime()), row('today-early', new Date(2026, 9, 25, 0, 0).getTime()), row('yesterday', new Date(2026, 9, 24, 23, 59).getTime()), row('week-edge', new Date(2026, 9, 18, 0, 0).getTime()), row('today-late', new Date(2026, 9, 25, 0, 4).getTime()), row('two-days', new Date(2026, 9, 23, 10).getTime())];
  const before = rows.map(r => r.id);
  const groups = groupConversations(rows, now);
  assert.deepEqual(groups.map(g => [g.label, g.sessions.map(s => s.id)]), [
    ['Today', ['today-late', 'today-early']], ['Yesterday', ['yesterday']], ['Previous 7 days', ['two-days', 'week-edge']], ['Older', ['old']],
  ]);
  assert.deepEqual(rows.map(r => r.id), before);
  assert.deepEqual(groupConversations([], now), []);
});

test('calendar grouping works across month/year and daylight-saving transitions', () => {
  const now = new Date(2027, 0, 1, 12);
  const groups = groupConversations([row('yesterday', new Date(2026, 11, 31, 12).getTime()), row('week', new Date(2026, 11, 25, 12).getTime())], now);
  assert.deepEqual(groups.map(g => g.label), ['Yesterday', 'Previous 7 days']);
  const afterClockChange = new Date(2026, 10, 2, 0, 30);
  const previousDay = new Date(2026, 10, 1, 0, 1);
  assert.equal(groupConversations([row('clock-change', previousDay.getTime())], afterClockChange)[0].label, 'Yesterday');
});

test('conversation search matches titles and previews case-insensitively', () => {
  const rows = [row('one', 1, 'Deploy API', 'Ready'), row('two', 2, 'Read files', 'API routes inspected'), row('three', 3, 'Other')];
  assert.deepEqual(filterConversations(rows, ' API ').map(r => r.id), ['one', 'two']);
  assert.deepEqual(filterConversations(rows, '   '), rows);
  assert.deepEqual(filterConversations(rows, 'missing'), []);
});

test('countdown rounds partial seconds up and supports six-hour suggestions', () => {
  assert.equal(formatCountdown(1001, 1000), '0:01');
  assert.equal(formatCountdown(61000, 1000), '1:00');
  assert.equal(formatCountdown(3601000, 1000), '1:00:00');
  assert.equal(formatCountdown(21601000, 1000), '6:00:00');
  assert.equal(formatCountdown(1000, 1000), 'Expired');
  assert.equal(formatCountdown(0, 1000), 'Expired');
  assert.equal(formatCountdown(Number.NaN, 1000), 'Expired');
});
