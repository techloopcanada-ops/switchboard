import AsyncStorage from '@react-native-async-storage/async-storage';
import { sameChat, serialQueue, type ChatTarget } from './chat-state';

export const CURRENT_KEY = 'switchboard.chat.current';
export const draftKey = (chatKey: string) => `switchboard.draft.${chatKey}`;
const DRAFTS_KEY = 'switchboard.chat.drafts';
const enqueue = serialQueue();
export interface SavedDraft extends ChatTarget { text: string; updatedAt: number }

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await enqueue(() => AsyncStorage.getItem(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  await enqueue(() => AsyncStorage.setItem(key, JSON.stringify(value)));
}

export async function removeKey(key: string): Promise<void> {
  await enqueue(() => AsyncStorage.removeItem(key));
}

export async function listDrafts(): Promise<SavedDraft[]> {
  return await getJson<SavedDraft[]>(DRAFTS_KEY) ?? [];
}

export async function readDraft(target: ChatTarget): Promise<string> {
  const saved = (await listDrafts()).find(draft => sameChat(draft, target));
  return saved?.text ?? await getJson<string>(draftKey(target.chatKey)) ?? '';
}

export function saveDraft(target: ChatTarget, text: string): Promise<void> {
  return enqueue(async () => {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    const drafts = (raw ? JSON.parse(raw) as SavedDraft[] : []).filter(draft => !sameChat(draft, target));
    if (text) drafts.push({ ...target, text, updatedAt: Date.now() });
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    await AsyncStorage.removeItem(draftKey(target.chatKey));
  });
}

/** A conversation id. The server creates the conversation when the first message is sent. */
export function newChatKey(): string {
  return `mobile:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
