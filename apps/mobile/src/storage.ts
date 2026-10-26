import AsyncStorage from '@react-native-async-storage/async-storage';

export const CURRENT_KEY = 'switchboard.chat.current';
export const draftKey = (chatKey: string) => `switchboard.draft.${chatKey}`;

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Losing a remembered draft or position must never break chatting.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** A conversation id. The server creates the conversation when the first message is sent. */
export function newChatKey(): string {
  return `mobile:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
