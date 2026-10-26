import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Type, type Static, type TSchema } from '@earendil-works/pi-ai';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolCategory } from './bots.ts';
import { homeDir } from './config.ts';
import { appendMemory } from './memory.ts';
import { readSkillBody, readSkillResource, writeUserSkill, type Skill } from './skills.ts';

export interface SwitchboardTool<T extends TSchema = TSchema> extends AgentTool<T> {
  category: ToolCategory;
}

/** Services a tool may call back into. Implemented by the runtime. */
export interface ToolServices {
  skills(): Skill[];
  sendMessage(channel: string, chatId: string, text: string): Promise<void>;
  scheduleWorkflow(input: { name: string; cron: string; bot: string; prompt: string; deliverChannel?: string; deliverChatId?: string }): Promise<string>;
  describeCapabilities(): string;
}

export interface ToolContext {
  botId: string;
  chatKey: string;
  channel: string;
  workdir: string;
  services: ToolServices;
}

const MAX_OUTPUT = 60_000;

function text(content: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: content }], details: details ?? null };
}

function clip(value: string, max = MAX_OUTPUT): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated ${value.length - max} characters]` : value;
}

/** Resolve a path inside the bot's working directory. Switchboard's own home is never reachable. */
export function resolveInside(workdir: string, target: string): string {
  const resolved = path.resolve(workdir, target);
  const root = path.resolve(workdir);
  const home = path.resolve(homeDir());
  if (resolved === home || resolved.startsWith(home + path.sep)) {
    if (!root.startsWith(home + path.sep) || resolved === home || !resolved.startsWith(root)) {
      throw new Error('Access to the Switchboard configuration directory is not allowed.');
    }
  }
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path must stay inside the working directory ${root}.`);
  }
  return resolved;
}

export function buildTools(ctx: ToolContext): SwitchboardTool[] {
  const ReadParams = Type.Object({
    path: Type.String({ description: 'File path, relative to the working directory.' }),
    offset: Type.Optional(Type.Integer({ minimum: 1, description: '1-based first line to return.' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: 'Maximum lines to return (default 400).' })),
  });
  const read_file: SwitchboardTool<typeof ReadParams> = {
    name: 'read_file', label: 'Read file', category: 'read', parameters: ReadParams,
    description: 'Read a UTF-8 text file from the working directory, with line numbers.',
    async execute(_id, params: Static<typeof ReadParams>) {
      const file = resolveInside(ctx.workdir, params.path);
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const start = (params.offset ?? 1) - 1;
      const slice = lines.slice(start, start + (params.limit ?? 400));
      const body = slice.map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`).join('\n');
      return text(clip(`${body}${start + slice.length < lines.length ? `\n…(${lines.length - start - slice.length} more lines)` : ''}`));
    },
  };

  const ListParams = Type.Object({ path: Type.Optional(Type.String({ description: 'Directory, relative to the working directory. Default "."' })) });
  const list_dir: SwitchboardTool<typeof ListParams> = {
    name: 'list_dir', label: 'List directory', category: 'read', parameters: ListParams,
    description: 'List files and folders (non-recursive). Folders end with /.',
    async execute(_id, params: Static<typeof ListParams>) {
      const dir = resolveInside(ctx.workdir, params.path ?? '.');
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.name !== 'node_modules' && e.name !== '.git')
        .map(e => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return text(entries.length ? clip(entries.join('\n')) : '(empty directory)');
    },
  };

  const WriteParams = Type.Object({
    path: Type.String({ description: 'File path, relative to the working directory. Parent folders are created.' }),
    content: Type.String({ description: 'Full file content.' }),
  });
  const write_file: SwitchboardTool<typeof WriteParams> = {
    name: 'write_file', label: 'Write file', category: 'write', parameters: WriteParams,
    description: 'Create or overwrite a text file.',
    async execute(_id, params: Static<typeof WriteParams>) {
      const file = resolveInside(ctx.workdir, params.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, params.content);
      return text(`Wrote ${params.content.length} characters to ${path.relative(ctx.workdir, file) || '.'}`);
    },
  };

  const EditParams = Type.Object({
    path: Type.String({ description: 'File path, relative to the working directory.' }),
    oldText: Type.String({ description: 'Exact text to replace. Must occur exactly once.' }),
    newText: Type.String({ description: 'Replacement text.' }),
  });
  const edit_file: SwitchboardTool<typeof EditParams> = {
    name: 'edit_file', label: 'Edit file', category: 'write', parameters: EditParams,
    description: 'Replace one exact occurrence of oldText with newText in a file.',
    async execute(_id, params: Static<typeof EditParams>) {
      const file = resolveInside(ctx.workdir, params.path);
      const current = fs.readFileSync(file, 'utf8');
      const first = current.indexOf(params.oldText);
      if (first === -1) throw new Error('oldText was not found in the file.');
      if (current.indexOf(params.oldText, first + 1) !== -1) throw new Error('oldText occurs more than once; include more context.');
      fs.writeFileSync(file, current.slice(0, first) + params.newText + current.slice(first + params.oldText.length));
      return text(`Edited ${path.relative(ctx.workdir, file)}`);
    },
  };

  const ShellParams = Type.Object({
    command: Type.String({ description: 'Command line to run in the working directory with the system shell.' }),
    timeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: 'Timeout in seconds (default 120).' })),
  });
  const shell: SwitchboardTool<typeof ShellParams> = {
    name: 'shell', label: 'Shell', category: 'shell', parameters: ShellParams, executionMode: 'sequential',
    description: 'Run a shell command in the working directory and return stdout and stderr. Use for builds, tests, git and scripts.',
    async execute(_id, params: Static<typeof ShellParams>, signal) {
      return new Promise(resolve => {
        const timeoutMs = (params.timeoutSec ?? 120) * 1000;
        const child = spawn(params.command, { cwd: ctx.workdir, shell: true, env: { ...process.env, SWITCHBOARD_BOT: ctx.botId }, windowsHide: true });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill(), timeoutMs);
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', d => { if (out.length < MAX_OUTPUT) out += String(d); });
        child.stderr.on('data', d => { if (err.length < MAX_OUTPUT) err += String(d); });
        child.on('error', e => { clearTimeout(timer); resolve({ ...text(`Failed to start: ${e.message}`), isError: true }); });
        child.on('close', (code, sig) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          const status = sig ? `killed by ${sig}${timer ? ' (timeout or abort)' : ''}` : `exit code ${code}`;
          const body = `${status}\n${out ? `--- stdout ---\n${clip(out)}\n` : ''}${err ? `--- stderr ---\n${clip(err)}` : ''}`.trim();
          resolve({ ...text(body, { code, signal: sig }), isError: code !== 0 });
        });
      });
    },
  };

  const FetchParams = Type.Object({
    url: Type.String({ description: 'http or https URL.' }),
    maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 200_000, description: 'Cap on returned text (default 20000).' })),
  });
  const web_fetch: SwitchboardTool<typeof FetchParams> = {
    name: 'web_fetch', label: 'Fetch web page', category: 'network', parameters: FetchParams,
    description: 'Download a web page or API response and return its readable text.',
    async execute(_id, params: Static<typeof FetchParams>, signal) {
      const url = new URL(params.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Switchboard/0.1 (+https://github.com)' }, redirect: 'follow' });
        const type = response.headers.get('content-type') ?? '';
        const raw = (await response.text()).slice(0, 2_000_000);
        const body = /html/i.test(type) ? htmlToText(raw) : raw;
        return text(`HTTP ${response.status} ${type}\n\n${clip(body, params.maxChars ?? 20_000)}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };

  const LoadSkillParams = Type.Object({
    name: Type.String({ description: 'Skill name from the skills list.' }),
    resource: Type.Optional(Type.String({ description: 'Optional file inside the skill, e.g. references/REFERENCE.md.' })),
  });
  const load_skill: SwitchboardTool<typeof LoadSkillParams> = {
    name: 'load_skill', label: 'Load skill', category: 'read', parameters: LoadSkillParams,
    description: 'Load the full instructions of an installed skill, or one of its resource files.',
    async execute(_id, params: Static<typeof LoadSkillParams>) {
      const skill = ctx.services.skills().find(s => s.name === params.name);
      if (!skill) throw new Error(`No skill named "${params.name}".`);
      return text(clip(params.resource ? readSkillResource(skill, params.resource) : readSkillBody(skill)));
    },
  };

  const SaveSkillParams = Type.Object({
    name: Type.String({ description: 'Lowercase name with hyphens, e.g. deploy-to-staging.' }),
    description: Type.String({ description: 'What the skill does and when to use it (under 1024 characters).' }),
    body: Type.String({ description: 'Markdown instructions: steps, examples, edge cases.' }),
  });
  const save_skill: SwitchboardTool<typeof SaveSkillParams> = {
    name: 'save_skill', label: 'Save skill', category: 'self-modify', parameters: SaveSkillParams,
    description: 'Save a reusable skill (agentskills.io format) so future sessions can load it. Use after solving a non-trivial task.',
    async execute(_id, params: Static<typeof SaveSkillParams>) {
      const skill = writeUserSkill(params.name, params.description, params.body);
      return text(`Saved skill ${skill.name} at ${skill.dir}`);
    },
  };

  const RememberParams = Type.Object({
    note: Type.String({ description: 'One short durable fact, preference or lesson.' }),
    scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('bot')], { description: 'user = about the person (shared by all bots), bot = your own notes. Default bot.' })),
  });
  const remember: SwitchboardTool<typeof RememberParams> = {
    name: 'remember', label: 'Remember', category: 'self-modify', parameters: RememberParams,
    description: 'Append a note to long-term memory (USER.md or your MEMORY.md).',
    async execute(_id, params: Static<typeof RememberParams>) {
      const line = appendMemory(params.scope === 'user' ? { user: true } : { botId: ctx.botId }, params.note);
      return text(`Saved: ${line}`);
    },
  };

  const SendParams = Type.Object({
    channel: Type.String({ description: 'telegram or discord' }),
    chatId: Type.String({ description: 'Chat or channel id on that platform.' }),
    text: Type.String({ description: 'Message text.' }),
  });
  const send_message: SwitchboardTool<typeof SendParams> = {
    name: 'send_message', label: 'Send message', category: 'messaging', parameters: SendParams,
    description: 'Send a message to a connected chat platform.',
    async execute(_id, params: Static<typeof SendParams>) {
      await ctx.services.sendMessage(params.channel, params.chatId, params.text);
      return text(`Sent to ${params.channel}:${params.chatId}`);
    },
  };

  const ScheduleParams = Type.Object({
    name: Type.String({ description: 'Workflow name (lowercase, hyphens).' }),
    cron: Type.String({ description: 'Cron expression, e.g. "0 9 * * 1-5" for 9:00 on weekdays.' }),
    bot: Type.String({ description: 'Bot id to run.' }),
    prompt: Type.String({ description: 'What the bot should do each run.' }),
    deliverChannel: Type.Optional(Type.String({ description: 'telegram or discord' })),
    deliverChatId: Type.Optional(Type.String({ description: 'Where to deliver the result.' })),
  });
  const schedule_workflow: SwitchboardTool<typeof ScheduleParams> = {
    name: 'schedule_workflow', label: 'Schedule workflow', category: 'self-modify', parameters: ScheduleParams,
    description: 'Create a scheduled workflow file that runs a bot on a cron schedule and delivers the result.',
    async execute(_id, params: Static<typeof ScheduleParams>) {
      const file = await ctx.services.scheduleWorkflow(params);
      return text(`Workflow saved to ${file}`);
    },
  };

  const NoParams = Type.Object({});
  const describe_capabilities: SwitchboardTool<typeof NoParams> = {
    name: 'describe_capabilities', label: 'Describe capabilities', category: 'read', parameters: NoParams,
    description: 'Return what this Switchboard installation can do right now: bots, tools, channels, skills, workflows, providers.',
    async execute() {
      return text(ctx.services.describeCapabilities());
    },
  };

  return [read_file, list_dir, write_file, edit_file, shell, web_fetch, load_skill, save_skill, remember, send_message, schedule_workflow, describe_capabilities] as SwitchboardTool[];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
