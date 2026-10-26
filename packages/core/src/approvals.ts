import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ToolCategory } from './bots.ts';

export type Decision = 'allow' | 'deny';
export type Outcome = Decision | 'timeout' | 'aborted';

export interface ApprovalRequest {
  id: string;
  botId: string;
  botName: string;
  chatKey: string;
  channel: string;
  toolName: string;
  category: ToolCategory;
  /** Short human-readable description of what the tool will do. */
  summary: string;
  args: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalResolved extends ApprovalRequest {
  decision: Outcome;
  decidedBy: string;
  decidedAt: number;
  /** The human chose "always allow": the runtime turns the bot's policy for this category to auto. */
  remember?: boolean;
}

interface Pending {
  request: ApprovalRequest;
  finish: (decision: Outcome, decidedBy: string, remember?: boolean) => void;
}

/**
 * Holds tool calls that wait for a human. Any surface (web UI, phone, Telegram, Discord)
 * can decide; the first decision wins and every surface is told.
 */
export class ApprovalCenter extends EventEmitter<{ created: [ApprovalRequest]; resolved: [ApprovalResolved] }> {
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super();
    this.timeoutMs = Math.max(5_000, timeoutMs);
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map(p => p.request).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)?.request;
  }

  /** `timeoutMs` overrides the default for long-lived requests such as skill suggestions. */
  request(input: Omit<ApprovalRequest, 'id' | 'createdAt' | 'expiresAt'>, signal?: AbortSignal, timeoutMs?: number): Promise<ApprovalResolved> {
    const createdAt = Date.now();
    const lifetime = timeoutMs ?? this.timeoutMs;
    const request: ApprovalRequest = { ...input, id: randomUUID(), createdAt, expiresAt: createdAt + lifetime };
    return new Promise<ApprovalResolved>(resolve => {
      const onAbort = () => finish('aborted', 'system');
      const timer = setTimeout(() => finish('timeout', 'system'), lifetime);
      const finish = (decision: Outcome, decidedBy: string, remember?: boolean) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const resolved: ApprovalResolved = { ...request, decision, decidedBy, decidedAt: Date.now(), ...(remember ? { remember: true } : {}) };
        resolve(resolved);
        this.emit('resolved', resolved);
      };
      this.pending.set(request.id, { request, finish });
      if (signal?.aborted) {
        finish('aborted', 'system');
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.emit('created', request);
    });
  }

  decide(id: string, decision: Decision, decidedBy: string, remember = false): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.finish(decision, decidedBy, decision === 'allow' && remember);
    return true;
  }

  /** Deny everything, used on shutdown. */
  clear(): void {
    for (const id of [...this.pending.keys()]) this.decide(id, 'deny', 'shutdown');
  }
}

export function summarizeToolCall(toolName: string, args: unknown): string {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const str = (key: string, max = 120) => {
    const v = a[key];
    return typeof v === 'string' ? (v.length > max ? `${v.slice(0, max)}…` : v) : undefined;
  };
  switch (toolName) {
    case 'shell': return `Run: ${str('command', 200) ?? '(no command)'}`;
    case 'write_file': return `Write file ${str('path') ?? ''} (${typeof a.content === 'string' ? a.content.length : 0} chars)`;
    case 'edit_file': return `Edit file ${str('path') ?? ''}`;
    case 'read_file': return `Read file ${str('path') ?? ''}`;
    case 'list_dir': return `List ${str('path') ?? '.'}`;
    case 'web_fetch': return `Fetch ${str('url', 160) ?? ''}`;
    case 'send_message': return `Send message to ${str('channel') ?? ''}:${str('chatId') ?? ''}`;
    case 'save_skill': return `Save skill "${str('name') ?? ''}"`;
    case 'remember': return `Remember: ${str('note') ?? ''}`;
    case 'schedule_workflow': return `Schedule workflow "${str('name') ?? ''}"`;
    default: return `${toolName} ${JSON.stringify(a).slice(0, 160)}`;
  }
}
