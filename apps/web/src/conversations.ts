import { conversationKey } from './chat-state.ts';
import type { SessionRow } from './types.ts';

export interface CurrentConversation { botId: string; chatKey: string }
type ConversationStorage = (Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>) | null | undefined;
const currentKey = 'switchboard.current';
const draftKey = ({ botId, chatKey }: CurrentConversation) => `switchboard.draft:${conversationKey(botId, chatKey)}`;

export function loadCurrent(storage: ConversationStorage, fallback: CurrentConversation): CurrentConversation {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(currentKey) ?? 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const value = saved as Record<string, unknown>;
      if (typeof value.botId === 'string' && value.botId.trim() && typeof value.chatKey === 'string' && value.chatKey.trim()) return { botId: value.botId, chatKey: value.chatKey };
    }
  } catch { /* Private browsing or damaged storage must not block a chat. */ }
  return { ...fallback };
}

export function saveCurrent(storage: ConversationStorage, current: CurrentConversation): void {
  try { storage?.setItem(currentKey, JSON.stringify(current)); } catch { /* The open conversation still works in memory. */ }
}

export function loadDraft(storage: ConversationStorage, current: CurrentConversation): string {
  try { return storage?.getItem(draftKey(current)) ?? ''; } catch { return ''; }
}

export function saveDraft(storage: ConversationStorage, current: CurrentConversation, text: string): void {
  try {
    if (text) storage?.setItem(draftKey(current), text);
    else storage?.removeItem(draftKey(current));
  } catch { /* A full or unavailable store must not interrupt typing. */ }
}

export function clearDraft(storage: ConversationStorage, current: CurrentConversation): void {
  try { storage?.removeItem(draftKey(current)); } catch { /* Clearing the visible composer can still succeed. */ }
}

export function listDrafts(storage: ConversationStorage): (CurrentConversation & { text: string })[] {
  const drafts: (CurrentConversation & { text: string })[] = [];
  try {
    if (!storage?.key) return drafts;
    for (let index = 0; index < (storage.length ?? 0); index++) {
      const key = storage.key(index);
      if (!key?.startsWith('switchboard.draft:')) continue;
      try {
        const ids: unknown = JSON.parse(key.slice('switchboard.draft:'.length));
        if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string' && id.trim())) continue;
        const text = storage.getItem(key);
        if (text?.trim()) drafts.push({ botId: ids[0], chatKey: ids[1], text });
      } catch { /* A damaged draft must not hide the remaining drafts. */ }
    }
  } catch { /* Storage can become unavailable while listing. */ }
  return drafts;
}

export function groupConversations(rows: SessionRow[], now = new Date()): { label: string; sessions: SessionRow[] }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today); week.setDate(week.getDate() - 7);
  const groups = ['Today', 'Yesterday', 'Previous 7 days', 'Older'].map(label => ({ label, sessions: [] as SessionRow[] }));
  for (const session of [...rows].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const index = session.updatedAt >= today.getTime() ? 0 : session.updatedAt >= yesterday.getTime() ? 1 : session.updatedAt >= week.getTime() ? 2 : 3;
    groups[index].sessions.push(session);
  }
  return groups.filter(group => group.sessions.length > 0);
}

export function filterConversations(rows: SessionRow[], query: string): SessionRow[] {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter(row => `${row.title}\n${row.preview ?? ''}`.toLocaleLowerCase().includes(search));
}

export function filterUnsentDrafts(drafts: (CurrentConversation & { text: string })[], sessions: SessionRow[] | undefined): (CurrentConversation & { text: string })[] {
  // Until the server list arrives, a local draft may belong to an existing conversation.
  if (!sessions) return [];
  const saved = new Set(sessions.map(session => conversationKey(session.botId, session.chatKey)));
  return drafts.filter(draft => draft.text.trim() && !saved.has(conversationKey(draft.botId, draft.chatKey)));
}

export function formatCountdown(expiresAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (!Number.isFinite(seconds) || !seconds) return 'Expired';
  const minutes = Math.floor(seconds / 60);
  const tail = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
