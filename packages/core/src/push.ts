import type { PushDevice } from './config.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Sends notifications through Expo's push service, so the phone app gets approvals without
 * Switchboard running any server of its own. Tokens come from the paired app.
 */
export async function sendPush(devices: PushDevice[], message: PushMessage): Promise<{ sent: number; errors: string[] }> {
  const tokens = devices.map(d => d.expoPushToken).filter(t => /^Expo(nent)?PushToken\[.+\]$/.test(t));
  if (!tokens.length) return { sent: 0, errors: [] };
  const errors: string[] = [];
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({ to, title: message.title, body: message.body, data: message.data ?? {}, sound: 'default', priority: 'high', channelId: 'approvals' }))),
    });
    if (!response.ok) errors.push(`Expo push HTTP ${response.status}`);
    else {
      const body = (await response.json()) as { data?: { status: string; message?: string }[] };
      for (const ticket of body.data ?? []) if (ticket.status !== 'ok') errors.push(ticket.message ?? 'push rejected');
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  return { sent: tokens.length - errors.length, errors };
}
