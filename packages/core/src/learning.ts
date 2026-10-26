import type { Message } from '@earendil-works/pi-ai';
import { validateSkillFrontmatter } from './skills.ts';

/** A reusable procedure a bot noticed in a finished conversation. Always human-approved before it is saved. */
export interface SkillProposal {
  name: string;
  description: string;
  body: string;
}

export const REFLECT_SYSTEM = `You review a finished conversation between a user and an AI agent and decide whether it produced a reusable procedure worth saving as a skill.

A skill is worth saving only when ALL of these hold:
- The agent completed a multi-step task using tools (commands, files, web pages).
- The way it was done is specific to this user's setup or preferences, or took real trial and error to get right.
- Someone could plausibly ask for the same kind of task again.
Do NOT save: one-off questions, small talk, general knowledge a model already has, or anything that failed.

If a skill with a similar name already exists, either improve it (reuse the exact name) or answer {"save": false}.

Answer with ONLY one JSON object, no prose:
{"save": false, "reason": "short reason"}
or
{"save": true, "name": "kebab-case-name", "description": "What it does and when to use it, under 300 characters", "body": "Markdown instructions"}

The body should contain: a one-line goal, numbered steps with the exact commands, paths and settings that worked, pitfalls met and how they were solved, and how to verify success. Keep it under 60 lines. Write instructions to the agent ("Run ...", "Check ..."), not a story about this conversation.`;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text ?? '') : '')).join(' ');
}

function brief(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Compact plain-text transcript for the reflection call. Keeps the end of long conversations. */
export function buildDigest(messages: Message[], existingSkills: string[], maxChars = 14_000): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`USER: ${brief(textOf(m.content), 600)}`);
    else if (m.role === 'assistant') {
      const parts = Array.isArray(m.content) ? m.content : [];
      const said = brief(parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join(' '), 500);
      if (said) lines.push(`AGENT: ${said}`);
      for (const p of parts) if (p.type === 'toolCall') lines.push(`  TOOL ${p.name} ${brief(p.arguments, 260)}`);
    } else if (m.role === 'toolResult') {
      lines.push(`  RESULT${m.isError ? ' (error)' : ''} ${m.toolName}: ${brief(textOf(m.content), 260)}`);
    }
  }
  let digest = lines.join('\n');
  if (digest.length > maxChars) digest = `…(earlier steps omitted)\n${digest.slice(digest.length - maxChars)}`;
  const known = existingSkills.length ? existingSkills.join(', ') : '(none)';
  return `Existing skills: ${known}\n\nConversation:\n${digest}`;
}

/** Extract and validate the model's JSON answer. Returns null when it declines or the answer is unusable. */
export function parseProposal(answer: string): { proposal: SkillProposal } | { reason: string } {
  const match = /\{[\s\S]*\}/.exec(answer.replace(/```(?:json)?/gi, ''));
  if (!match) return { reason: 'The model did not return a decision.' };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { reason: 'The model returned an unreadable decision.' };
  }
  if (data.save !== true) return { reason: typeof data.reason === 'string' && data.reason ? data.reason : 'Nothing in this conversation looks reusable yet.' };
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  try {
    validateSkillFrontmatter({ name, description }, name);
  } catch (error) {
    return { reason: `The suggested skill was invalid: ${(error as Error).message}` };
  }
  if (body.length < 40) return { reason: 'The suggested skill had no real instructions.' };
  if (body.length > 12_000) return { reason: 'The suggested skill was too long to be useful.' };
  return { proposal: { name, description: description.slice(0, 1000), body } };
}
