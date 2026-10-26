import type { Message } from './types.ts';

export interface ToolActivity {
  id: string;
  name: string;
  args?: unknown;
  output?: string;
  isError?: boolean;
}

export interface TranscriptRow {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  tools: ToolActivity[];
  error?: string;
  usage?: Message['usage'];
  retryText: string;
}

export function messageText(message: Pick<Message, 'content'>): string {
  return typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
}

export function groupTranscript(messages: Message[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const calls = new Map<string, ToolActivity>();
  let retryText = '';
  for (const [index, message] of messages.entries()) {
    if (message.role === 'toolResult') {
      const call = message.toolCallId ? calls.get(message.toolCallId) : [...calls.values()].reverse().find(tool => tool.name === message.toolName && tool.output === undefined);
      if (call) {
        call.output = messageText(message);
        call.isError = message.isError;
      } else {
        rows.push({ role: 'tool', text: '', retryText, tools: [{ id: message.toolCallId ?? `result-${index}`, name: message.toolName ?? 'tool', output: messageText(message), isError: message.isError }] });
      }
      continue;
    }
    const text = messageText(message);
    if (message.role === 'user') retryText = text;
    const tools: ToolActivity[] = [];
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const [blockIndex, block] of message.content.entries()) {
        if (block.type !== 'toolCall') continue;
        const tool = { id: block.id ?? `call-${index}-${blockIndex}`, name: block.name ?? 'tool', args: block.arguments };
        tools.push(tool);
        calls.set(tool.id, tool);
      }
    }
    rows.push({ role: message.role, text, tools, error: message.errorMessage, usage: message.usage, retryText });
  }
  return rows;
}

export function toolSummary(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const values = args as Record<string, unknown>;
  const value = ['path', 'command', 'url', 'name', 'query', 'resource'].map(key => values[key]).find(value => typeof value === 'string');
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, 100) : '';
}

export function shouldStickToBottom({ scrollTop, scrollHeight, clientHeight }: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 80): boolean {
  return scrollHeight - clientHeight - scrollTop <= threshold;
}
