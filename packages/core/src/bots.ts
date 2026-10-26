import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.ts';

export type ToolCategory = 'read' | 'write' | 'shell' | 'network' | 'messaging' | 'self-modify';
export type ApprovalMode = 'auto' | 'ask' | 'never';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export const TOOL_CATEGORIES: ToolCategory[] = ['read', 'write', 'shell', 'network', 'messaging', 'self-modify'];

export const DEFAULT_POLICY: Record<ToolCategory, ApprovalMode> = {
  read: 'auto',
  write: 'ask',
  shell: 'ask',
  network: 'ask',
  messaging: 'ask',
  'self-modify': 'ask',
};

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  model: { provider: string; id: string };
  thinking: ThinkingLevel;
  /** Tool names this bot may use. '*' means every registered tool. */
  tools: string[] | '*';
  /** Skill names visible to the bot. '*' means every installed skill. */
  skills: string[] | '*';
  memory: boolean;
  /** Monthly spend cap in USD, computed from provider price catalogs. 0 disables the cap. */
  budgetUsd: number;
  policy: Partial<Record<ToolCategory, ApprovalMode>>;
  workdir?: string;
  builtin?: boolean;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function botsDir(): string {
  return path.join(homeDir(), 'bots');
}

export function validateBot(input: unknown): Bot {
  if (!input || typeof input !== 'object') throw new Error('Bot must be an object.');
  const b = input as Record<string, unknown>;
  if (typeof b.id !== 'string' || !ID_PATTERN.test(b.id)) throw new Error('Bot id must be 1-40 lowercase letters, digits or hyphens.');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) throw new Error('Bot name must be 1-60 characters.');
  if (typeof b.systemPrompt !== 'string' || b.systemPrompt.length > 20000) throw new Error('System prompt must be text up to 20,000 characters.');
  const model = b.model as Record<string, unknown> | undefined;
  if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') throw new Error('Bot model needs a provider and an id.');
  const tools = b.tools === '*' ? '*' : Array.isArray(b.tools) && b.tools.every(t => typeof t === 'string') ? (b.tools as string[]) : undefined;
  if (tools === undefined) throw new Error('Bot tools must be "*" or a list of tool names.');
  const skills = b.skills === '*' ? '*' : Array.isArray(b.skills) && b.skills.every(t => typeof t === 'string') ? (b.skills as string[]) : undefined;
  if (skills === undefined) throw new Error('Bot skills must be "*" or a list of skill names.');
  const budget = typeof b.budgetUsd === 'number' && Number.isFinite(b.budgetUsd) && b.budgetUsd >= 0 ? b.budgetUsd : 0;
  const policy: Partial<Record<ToolCategory, ApprovalMode>> = {};
  if (b.policy && typeof b.policy === 'object') {
    for (const [k, v] of Object.entries(b.policy as Record<string, unknown>)) {
      if (!TOOL_CATEGORIES.includes(k as ToolCategory)) throw new Error(`Unknown tool category "${k}".`);
      if (v !== 'auto' && v !== 'ask' && v !== 'never') throw new Error(`Policy for ${k} must be auto, ask or never.`);
      policy[k as ToolCategory] = v;
    }
  }
  const thinking = (['off', 'minimal', 'low', 'medium', 'high'] as const).includes(b.thinking as ThinkingLevel) ? (b.thinking as ThinkingLevel) : 'off';
  return {
    id: b.id,
    name: b.name.trim(),
    emoji: typeof b.emoji === 'string' ? b.emoji.slice(0, 8) : '🤖',
    description: typeof b.description === 'string' ? b.description.slice(0, 500) : '',
    systemPrompt: b.systemPrompt,
    model: { provider: model.provider, id: model.id },
    thinking,
    tools,
    skills,
    memory: b.memory !== false,
    budgetUsd: budget,
    policy,
    workdir: typeof b.workdir === 'string' && b.workdir ? b.workdir : undefined,
    builtin: b.builtin === true,
  };
}

export function loadBots(): Bot[] {
  const dir = botsDir();
  if (!fs.existsSync(dir)) return [];
  const bots: Bot[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      bots.push(validateBot(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))));
    } catch (error) {
      console.warn(`Skipping bot file ${file}: ${(error as Error).message}`);
    }
  }
  return bots;
}

export function saveBot(bot: Bot): Bot {
  const valid = validateBot(bot);
  fs.mkdirSync(botsDir(), { recursive: true });
  fs.writeFileSync(path.join(botsDir(), `${valid.id}.json`), JSON.stringify(valid, null, 2));
  return valid;
}

export function deleteBot(id: string): boolean {
  const file = path.join(botsDir(), `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function effectivePolicy(bot: Bot, category: ToolCategory): ApprovalMode {
  return bot.policy[category] ?? DEFAULT_POLICY[category];
}

const CODER_PROMPT = `You are Coder, a careful software engineering agent running on the user's machine through Switchboard.
Work in the current working directory. Read before you write. Prefer small, verifiable changes. Run tests when they exist.
Explain what you changed in a few sentences. Never claim something works unless you ran it. Ask before destructive actions.`;

const ASSISTANT_PROMPT = `You are Assistant, a concise general-purpose helper running through Switchboard.
Answer directly. Use tools when they help: read files, fetch pages, remember facts the user asks you to keep.
If a request would need shell or file writes, say so and ask whether the user wants the Coder bot.`;

const GUIDE_PROMPT = `You are Guide, the built-in tutorial bot for Switchboard.
Your job is to teach the user what Switchboard can do and how to set it up. Always call describe_capabilities first so your answer reflects this installation: which bots, tools, channels, skills and workflows exist right now.
Explain in plain language with short numbered steps. When something is not configured, say exactly where to configure it (the web UI tab or config file). Never invent features.`;

export function builtinBots(defaultModel: { provider: string; id: string }): Bot[] {
  return [
    validateBot({
      id: 'assistant', name: 'Assistant', emoji: '💬', description: 'General helper with read-only tools and memory.',
      systemPrompt: ASSISTANT_PROMPT, model: defaultModel, thinking: 'off', tools: ['read_file', 'list_dir', 'web_fetch', 'remember', 'load_skill'],
      skills: '*', memory: true, budgetUsd: 0, policy: {}, builtin: true,
    }),
    validateBot({
      id: 'coder', name: 'Coder', emoji: '🛠️', description: 'Coding agent with files, shell, web and skills. Writes and shell runs ask for approval.',
      systemPrompt: CODER_PROMPT, model: defaultModel, thinking: 'medium', tools: '*', skills: '*', memory: true, budgetUsd: 0, policy: {}, builtin: true,
    }),
    validateBot({
      id: 'guide', name: 'Guide', emoji: '🧭', description: 'Tutorial bot that explains this installation and how to use it.',
      systemPrompt: GUIDE_PROMPT, model: defaultModel, thinking: 'off', tools: ['describe_capabilities', 'load_skill'], skills: '*', memory: false, budgetUsd: 0,
      policy: {}, builtin: true,
    }),
  ];
}
