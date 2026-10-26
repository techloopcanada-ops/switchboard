import type { ChatEvent } from './types.ts';

export interface LiveRun {
  runId: string; sessionId: string; text: string; active: boolean;
  tools: { id: string; name: string; args?: unknown; output?: string; isError?: boolean }[];
  costUsd?: number; inputTokens?: number; outputTokens?: number; error?: string; interrupted?: boolean;
}
export const conversationKey = (botId: string, chatKey: string) => JSON.stringify([botId, chatKey]);
export function applyChatEvent(runs: Record<string, LiveRun>, event: ChatEvent): Record<string, LiveRun> {
  if (event.type === 'start') return { ...runs, [conversationKey(event.botId, event.chatKey)]: {
    runId: event.runId, sessionId: event.sessionId, text: '', active: true, tools: [],
  } };
  const key = Object.keys(runs).find(key => runs[key].runId === event.runId);
  if (!key) return runs;
  const previous = runs[key];
  let run = { ...previous };
  switch (event.type) {
    case 'delta': run.text += event.text; break;
    case 'tool_start': run.tools = [...run.tools, { id: event.toolCallId, name: event.toolName, args: event.args }]; break;
    case 'tool_end': run.tools = run.tools.map(tool => tool.id === event.toolCallId ? { ...tool, output: event.output, isError: event.isError } : tool); break;
    case 'done': run = { ...run, ...event, active: false }; break;
    case 'error': run = { ...run, active: false, error: event.message }; break;
  }
  return { ...runs, [key]: run };
}
