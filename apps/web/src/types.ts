export type { Bot, Config, ProviderConfig, ProviderSummary, ModelSummary, Skill, ReferralLink, ApprovalRequest, ApprovalResolved, ChatEvent, SessionRow, Workflow, PushDevice } from '@switchboard/core';
import type { ApprovalRequest, ApprovalResolved, Bot, ChatEvent } from '@switchboard/core';
export type ServerMessage =
  | { type: 'hello'; bots: Bot[]; approvals: ApprovalRequest[]; version: string }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'chat'; event: ChatEvent }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval_resolved'; resolved: ApprovalResolved }
  | { type: 'chat_result'; requestId: string; result: { error?: string; sessionId: string } }
  | { type: 'command_result'; requestId: string; command: { reply: string; switchBot?: string; newConversation?: boolean } }
  | { type: 'skill_learned'; name: string }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'abort_result'; ok: boolean }
  | { type: 'approve_result'; id: string; ok: boolean }
  | { type: 'pong' };
export interface ApprovalDecision { decision: 'allow' | 'deny'; by: string; remember?: boolean }
export interface Message {
  role: 'user' | 'assistant' | 'toolResult';
  content: string | { type: string; id?: string; text?: string; name?: string; arguments?: unknown }[];
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
  usage?: { input: number; output: number; cost: { total: number } };
}
