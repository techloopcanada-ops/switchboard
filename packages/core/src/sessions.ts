import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { homeDir } from './config.ts';

export interface SessionRow {
  id: string;
  botId: string;
  chatKey: string;
  channel: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Present on listings: number of stored messages. */
  messageCount?: number;
  /** Present on listings: the start of the most recent user message. */
  preview?: string;
}

export interface UsageSummary {
  botId: string;
  cost: number;
  input: number;
  output: number;
  requests: number;
}

/** Local SQLite store for sessions, transcripts, usage and the approval log. */
export class SessionStore {
  private readonly db: DatabaseSync;

  constructor(file = path.join(homeDir(), 'switchboard.db')) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, chat_key TEXT NOT NULL, channel TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE (bot_id, chat_key)
      );
      CREATE TABLE IF NOT EXISTS messages (
        session_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, json TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, session_id TEXT, ts INTEGER NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cost REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_bot_ts ON usage (bot_id, ts);
      CREATE TABLE IF NOT EXISTS approvals_log (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, decision TEXT NOT NULL,
        decided_by TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** Read-only lookup: opening a conversation in a UI must not create rows. */
  findSession(botId: string, chatKey: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE bot_id = ? AND chat_key = ?').get(botId, chatKey) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : undefined;
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : undefined;
  }

  getOrCreateSession(botId: string, chatKey: string, channel: string): SessionRow {
    const existing = this.findSession(botId, chatKey);
    if (existing) return existing;
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO sessions (id, bot_id, chat_key, channel, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, botId, chatKey, channel, '', now, now);
    return { id, botId, chatKey, channel, title: '', createdAt: now, updatedAt: now };
  }

  /**
   * Conversations that have at least one message, newest first, across all bots unless one is given.
   * Empty rows (a conversation opened but never used) are hidden.
   */
  listSessions(botId?: string, limit = 300): SessionRow[] {
    const rows = (botId
      ? this.db.prepare('SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS n FROM sessions s WHERE s.bot_id = ? ORDER BY s.updated_at DESC LIMIT ?').all(botId, limit)
      : this.db.prepare('SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS n FROM sessions s ORDER BY s.updated_at DESC LIMIT ?').all(limit)
    ) as Record<string, unknown>[];
    const lastUser = this.db.prepare("SELECT json FROM messages WHERE session_id = ? AND role = 'user' ORDER BY seq DESC LIMIT 1");
    return rows.filter(r => Number(r.n) > 0).map(r => {
      const session = rowToSession(r);
      session.messageCount = Number(r.n);
      const last = lastUser.get(session.id) as { json: string } | undefined;
      if (last) session.preview = previewOf(last.json);
      return session;
    });
  }

  messageCount(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(sessionId) as { n: number };
    return Number(row.n);
  }

  loadMessages<T>(sessionId: string): T[] {
    const rows = this.db.prepare('SELECT json FROM messages WHERE session_id = ? ORDER BY seq').all(sessionId) as { json: string }[];
    return rows.map(r => JSON.parse(r.json) as T);
  }

  /** Persist one message the moment it completes, so a crash or restart never loses a conversation. */
  appendMessage(sessionId: string, seq: number, message: { role: string }): void {
    const now = Date.now();
    this.db.prepare('INSERT OR REPLACE INTO messages (session_id, seq, role, json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, seq, message.role, JSON.stringify(message), now);
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  }

  /** Replace the whole transcript (used by tests and imports). */
  replaceMessages(sessionId: string, messages: { role: string }[], title?: string): void {
    const now = Date.now();
    const insert = this.db.prepare('INSERT INTO messages (session_id, seq, role, json, created_at) VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      messages.forEach((m, i) => insert.run(sessionId, i, m.role, JSON.stringify(m), now));
      if (title !== undefined) this.db.prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?').run(now, title.slice(0, 80), sessionId);
      else this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setTitleIfEmpty(sessionId: string, title: string): void {
    this.db.prepare("UPDATE sessions SET title = ? WHERE id = ? AND title = ''").run(title.slice(0, 80), sessionId);
  }

  renameSession(sessionId: string, title: string): boolean {
    return this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title.trim().slice(0, 80), sessionId).changes > 0;
  }

  /** Start fresh in a fixed-key channel (Telegram, Discord) while keeping the old conversation, viewable in the app. */
  archiveSession(botId: string, chatKey: string): boolean {
    const session = this.findSession(botId, chatKey);
    if (!session) return false;
    this.db.prepare('UPDATE sessions SET chat_key = ? WHERE id = ?').run(`${chatKey}:archived-${Date.now().toString(36)}`, session.id);
    return true;
  }

  resetSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?').run(Date.now(), '', sessionId);
  }

  deleteSession(sessionId: string): boolean {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    return this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes > 0;
  }

  /** Remove conversations that were opened but never used and are older than the cutoff. */
  purgeEmptySessions(olderThanMs = 10 * 60_000): number {
    const cutoff = Date.now() - olderThanMs;
    return this.db.prepare('DELETE FROM sessions WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id)').run(cutoff).changes as number;
  }

  addUsage(entry: { botId: string; sessionId?: string; provider: string; model: string; input: number; output: number; cost: number }): void {
    this.db.prepare('INSERT INTO usage (bot_id, session_id, ts, provider, model, input, output, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.botId, entry.sessionId ?? null, Date.now(), entry.provider, entry.model, entry.input, entry.output, entry.cost);
  }

  /** Spend since the first day of the current month (local time). */
  monthlyUsage(botId?: string): UsageSummary[] {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const rows = (botId
      ? this.db.prepare('SELECT bot_id, SUM(cost) AS cost, SUM(input) AS input, SUM(output) AS output, COUNT(*) AS requests FROM usage WHERE ts >= ? AND bot_id = ? GROUP BY bot_id').all(start.getTime(), botId)
      : this.db.prepare('SELECT bot_id, SUM(cost) AS cost, SUM(input) AS input, SUM(output) AS output, COUNT(*) AS requests FROM usage WHERE ts >= ? GROUP BY bot_id').all(start.getTime())
    ) as Record<string, unknown>[];
    return rows.map(r => ({ botId: String(r.bot_id), cost: Number(r.cost ?? 0), input: Number(r.input ?? 0), output: Number(r.output ?? 0), requests: Number(r.requests ?? 0) }));
  }

  monthlyCost(botId: string): number {
    return this.monthlyUsage(botId)[0]?.cost ?? 0;
  }

  logApproval(entry: { id: string; botId: string; tool: string; args: unknown; decision: string; decidedBy: string; createdAt: number }): void {
    this.db.prepare('INSERT OR REPLACE INTO approvals_log (id, bot_id, tool, args, decision, decided_by, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, entry.botId, entry.tool, JSON.stringify(entry.args ?? null).slice(0, 4000), entry.decision, entry.decidedBy, entry.createdAt, Date.now());
  }

  recentApprovals(limit = 50): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM approvals_log ORDER BY decided_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  }
}

function previewOf(json: string): string {
  try {
    const m = JSON.parse(json) as { content?: string | { type: string; text?: string }[] };
    const text = typeof m.content === 'string' ? m.content : (m.content ?? []).map(c => c.text ?? '').join(' ');
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  } catch {
    return '';
  }
}

function rowToSession(r: Record<string, unknown>): SessionRow {
  return {
    id: String(r.id), botId: String(r.bot_id), chatKey: String(r.chat_key), channel: String(r.channel), title: String(r.title ?? ''),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
