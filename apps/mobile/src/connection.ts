import * as SecureStore from 'expo-secure-store';

export interface Connection {
  url: string;
  token: string;
  deviceId: string;
}

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  description: string;
  model: { provider: string; id: string };
}

export interface SessionRow {
  id: string;
  botId: string;
  chatKey: string;
  channel: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  preview?: string;
}

export interface CommandOutcome {
  reply: string;
  switchBot?: string;
  newConversation?: boolean;
}

export interface Approval {
  id: string;
  botId: string;
  botName: string;
  chatKey: string;
  channel: string;
  toolName: string;
  category: string;
  summary: string;
  args: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalResolved extends Approval {
  decision: 'allow' | 'deny' | 'timeout' | 'aborted';
  decidedBy: string;
}

export type ChatEvent =
  | { type: 'start'; runId: string; botId: string; chatKey: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool_start'; runId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; runId: string; toolCallId: string; toolName: string; isError: boolean; output: string }
  | { type: 'done'; runId: string; text: string; costUsd: number; inputTokens: number; outputTokens: number }
  | { type: 'error'; runId: string; message: string };

export type ServerMessage =
  | { type: 'hello'; version: string; bots: Bot[]; approvals: Approval[] }
  | { type: 'chat'; event: ChatEvent }
  | { type: 'approval'; request: Approval }
  | { type: 'approval_resolved'; resolved: ApprovalResolved }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'chat_result'; requestId?: string; result: { text: string; error?: string; sessionId: string } }
  | { type: 'command_result'; requestId?: string; command: CommandOutcome }
  | { type: 'skill_learned'; name: string }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'pong' }
  | { type: 'approve_result'; id: string; ok: boolean }
  | { type: 'abort_result'; ok: boolean };

const KEY = 'switchboard.connection';

export async function loadConnection(): Promise<Connection | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Connection;
    return parsed.url && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: Connection): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Parse a pairing payload: switchboard://pair?url=...&token=... or raw JSON from the Pair tab. */
export function parsePairing(text: string): { url: string; token: string } | null {
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith('switchboard://')) {
      const u = new URL(trimmed.replace('switchboard://', 'https://x/'));
      const url = u.searchParams.get('url');
      const token = u.searchParams.get('token');
      return url && token ? { url: normalizeUrl(url), token } : null;
    }
    if (trimmed.startsWith('{')) {
      const j = JSON.parse(trimmed) as { url?: string; urls?: string[]; token?: string };
      const url = j.url ?? j.urls?.[0];
      return url && j.token ? { url: normalizeUrl(url), token: j.token } : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeUrl(url: string): string {
  const withScheme = /^https?:\/\//.test(url) ? url : `http://${url}`;
  return withScheme.replace(/\/+$/, '');
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(connection: Connection, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${connection.url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) throw new ApiError(response.status, (body as { error?: string } | null)?.error ?? `HTTP ${response.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal reconnecting WebSocket client for the daemon's /ws endpoint. */
export class Socket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly listeners = new Set<(message: ServerMessage) => void>();
  readonly statusListeners = new Set<(online: boolean) => void>();
  online = false;

  constructor(private readonly connection: Connection) {}

  connect(): void {
    if (this.closed) return;
    const wsUrl = `${this.connection.url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(this.connection.token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.setOnline(true); };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        for (const listener of this.listeners) listener(message);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => { this.setOnline(false); this.scheduleReconnect(); };
    ws.onerror = () => { ws.close(); };
  }

  private setOnline(value: boolean): void {
    if (this.online === value) return;
    this.online = value;
    for (const listener of this.statusListeners) listener(value);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer) return;
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt++, 4));
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, delay);
  }

  send(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}
