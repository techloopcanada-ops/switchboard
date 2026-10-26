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

  getOrCreateSession(botId: string, chatKey: string, channel: string): SessionRow {
    const existing = this.db.prepare('SELECT * FROM sessions WHERE bot_id = ? AND chat_key = ?').get(botId, chatKey) as Record<string, unknown> | undefined;
    if (existing) return rowToSession(existing);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO sessions (id, bot_id, chat_key, channel, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, botId, chatKey, channel, '', now, now);
    return { id, botId, chatKey, channel, title: '', createdAt: now, updatedAt: now };
  }

  listSessions(botId?: string): SessionRow[] {
    const rows = botId
      ? this.db.prepare('SELECT * FROM sessions WHERE bot_id = ? ORDER BY updated_at DESC').all(botId)
      : this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all();
    return (rows as Record<string, unknown>[]).map(rowToSession);
  }

  loadMessages<T>(sessionId: string): T[] {
    const rows = this.db.prepare('SELECT json FROM messages WHERE session_id = ? ORDER BY seq').all(sessionId) as { json: string }[];
    return rows.map(r => JSON.parse(r.json) as T);
  }

  /** Replace the whole transcript; the agent owns message ordering. */
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

  resetSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?').run(Date.now(), '', sessionId);
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
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

function rowToSession(r: Record<string, unknown>): SessionRow {
  return {
    id: String(r.id), botId: String(r.bot_id), chatKey: String(r.chat_key), channel: String(r.channel), title: String(r.title ?? ''),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
