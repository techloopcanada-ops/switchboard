export type { Bot, Config, ProviderConfig, ProviderSummary, ModelSummary, Skill, ReferralLink, ApprovalRequest, ApprovalResolved, ChatEvent, SessionRow, Workflow, PushDevice } from '@switchboard/core';
import type { ApprovalRequest, ApprovalResolved, Bot, ChatEvent } from '@switchboard/core';
export type ServerMessage =
  | { type: 'hello'; bots: Bot[]; approvals: ApprovalRequest[]; version: string }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'chat'; event: ChatEvent }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval_resolved'; resolved: ApprovalResolved }
  | { type: 'chat_result'; requestId: string; result: { error?: string; sessionId: string } }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'abort_result'; ok: boolean }
  | { type: 'approve_result' | 'pong' };
export interface Message {
  role: 'user' | 'assistant' | 'toolResult';
  content: string | { type: string; text?: string; name?: string; arguments?: unknown }[];
  toolName?: string;
  errorMessage?: string;
  usage?: { input: number; output: number; cost: { total: number } };
}
