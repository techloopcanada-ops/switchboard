import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, type AgentEvent, type BeforeToolCallContext, type BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { ApprovalCenter, summarizeToolCall, type ApprovalRequest, type ApprovalResolved } from './approvals.ts';
import { builtinBots, effectivePolicy, loadBots, saveBot, upgradeBuiltinBot, type Bot, type ToolCategory } from './bots.ts';
import { ensureHome, loadConfig, saveConfig, type Config } from './config.ts';
import { buildDigest, parseProposal, REFLECT_SYSTEM, type SkillProposal } from './learning.ts';
import { memoryPromptSection } from './memory.ts';
import { ModelRegistry } from './models.ts';
import { SessionStore, type SessionRow } from './sessions.ts';
import { loadSkills, skillsManifest, writeUserSkill, type Skill } from './skills.ts';
import { buildTools, type SwitchboardTool, type ToolServices } from './tools.ts';
import { loadWorkflows, saveWorkflowYaml, workflowToYaml, WorkflowScheduler, type Workflow } from './workflows.ts';

export type ChatEvent =
  | { type: 'start'; runId: string; botId: string; chatKey: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool_start'; runId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; runId: string; toolCallId: string; toolName: string; isError: boolean; output: string }
  | { type: 'done'; runId: string; text: string; costUsd: number; inputTokens: number; outputTokens: number }
  | { type: 'error'; runId: string; message: string };

export interface ChatInput {
  botId: string;
  /** Stable key for the conversation, e.g. "web:default" or "telegram:12345". */
  chatKey: string;
  channel: string;
  text: string;
  /** Workflows may force approvals: auto approves everything, never blocks anything that would ask. */
  approvalOverride?: 'auto' | 'never';
  fresh?: boolean;
  onEvent?: (event: ChatEvent) => void;
}

export interface ChatResult {
  runId: string;
  sessionId: string;
  text: string;
  costUsd: number;
  error?: string;
}

/** What a slash command did. UIs apply `switchBot` and `newConversation`; `reply` is shown to the user, never sent to the model. */
export interface CommandOutcome {
  reply: string;
  switchBot?: string;
  newConversation?: boolean;
}

export const COMMAND_HELP = [
  '/help — this list',
  '/bots — list bots',
  '/bot <id> — switch bot for this chat',
  '/new — start a new conversation (the old one is kept)',
  '/skills — list installed skills',
  '/learn [hint] — review this conversation and suggest a skill to save',
  '/usage — spend this month',
  '/status — what this Switchboard can do',
].join('\n');

const COMMAND_NAMES = new Set(['help', 'bots', 'bot', 'new', 'skills', 'learn', 'usage', 'status']);
const LEARN_COOLDOWN_MS = 15 * 60_000;
const SKILL_PROPOSAL_LIFETIME_MS = 6 * 60 * 60_000;
/** Tool calls that say nothing about having done real work, so they do not count toward learning. */
const NOT_WORK = new Set(['load_skill', 'describe_capabilities', 'remember', 'save_skill']);

export interface ChannelAdapter {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
  notifyApproval?(request: ApprovalRequest): Promise<void>;
  notifyResolved?(resolved: ApprovalResolved): Promise<void>;
}

interface Events {
  chat: [ChatEvent];
  approval: [ApprovalRequest];
  approval_resolved: [ApprovalResolved];
  config: [Config];
  bots: [Bot[]];
  skill_learned: [string];
}

export const VERSION = '0.1.0';

/** The Switchboard runtime: one process owning bots, models, sessions, approvals, workflows and channels. */
export class Switchboard extends EventEmitter<Events> {
  config: Config;
  readonly registry = new ModelRegistry();
  readonly store: SessionStore;
  approvals: ApprovalCenter;
  private bots = new Map<string, Bot>();
  private skills: Skill[] = [];
  private workflows: Workflow[] = [];
  private workflowErrors: Record<string, string> = {};
  readonly scheduler: WorkflowScheduler;
  private readonly channels = new Map<string, ChannelAdapter>();
  private readonly runs = new Map<string, Promise<unknown>>();
  private readonly active = new Map<string, Agent>();
  readonly startedAt = Date.now();
  private runCounter = 0;
  private readonly background = new Set<Promise<unknown>>();
  private readonly lastLearn = new Map<string, number>();

  private constructor(config: Config) {
    super();
    this.config = config;
    this.store = new SessionStore();
    this.approvals = this.createApprovals();
    this.scheduler = new WorkflowScheduler(async (w, reason) => { await this.runWorkflow(w, reason); });
  }

  static async create(): Promise<Switchboard> {
    ensureHome();
    const sb = new Switchboard(loadConfig());
    sb.store.purgeEmptySessions();
    await sb.registry.applyConfig(sb.config);
    sb.reloadBots();
    sb.reloadSkills();
    sb.reloadWorkflows();
    return sb;
  }

  private createApprovals(): ApprovalCenter {
    const center = new ApprovalCenter(this.config.approvalTimeoutSec * 1000);
    center.on('created', request => {
      this.emit('approval', request);
      for (const channel of this.channels.values()) channel.notifyApproval?.(request).catch(() => undefined);
    });
    center.on('resolved', resolved => {
      this.store.logApproval({ id: resolved.id, botId: resolved.botId, tool: resolved.toolName, args: resolved.args, decision: resolved.decision, decidedBy: resolved.decidedBy, createdAt: resolved.createdAt });
      if (resolved.remember && resolved.decision === 'allow') this.rememberAllow(resolved.botId, resolved.category);
      this.emit('approval_resolved', resolved);
      for (const channel of this.channels.values()) channel.notifyResolved?.(resolved).catch(() => undefined);
    });
    return center;
  }

  // ---- configuration -------------------------------------------------------

  async updateConfig(patch: Partial<Config>): Promise<Config> {
    const previous = this.config;
    const next: Config = { ...this.config, ...patch, server: { ...this.config.server, ...(patch.server ?? {}) } };
    saveConfig(next);
    this.config = next;
    await this.registry.applyConfig(next);
    if (next.approvalTimeoutSec !== previous.approvalTimeoutSec && this.approvals.list().length === 0) {
      this.approvals.removeAllListeners();
      this.approvals = this.createApprovals();
    }
    if (patch.defaultModel && (patch.defaultModel.provider !== previous.defaultModel?.provider || patch.defaultModel.id !== previous.defaultModel?.id)) {
      // Bots still on the old default follow the new default; bots the user pointed elsewhere keep their model.
      for (const bot of this.bots.values()) {
        const onOldDefault = previous.defaultModel && bot.model.provider === previous.defaultModel.provider && bot.model.id === previous.defaultModel.id;
        if (onOldDefault || (!previous.defaultModel && bot.builtin)) saveBot({ ...bot, model: patch.defaultModel });
      }
      this.reloadBots();
    }
    this.emit('config', next);
    return next;
  }

  // ---- bots, skills, workflows ---------------------------------------------

  /** "Always allow": turn the bot's approval policy for this tool category to auto, and keep it. */
  private rememberAllow(botId: string, category: ToolCategory): void {
    const bot = this.bots.get(botId);
    if (!bot) return;
    this.upsertBot({ ...bot, policy: { ...bot.policy, [category]: 'auto' } });
  }

  reloadBots(): Bot[] {
    let bots = loadBots();
    const fallback = this.config.defaultModel ?? { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.5' };
    const fresh = builtinBots(fallback);
    if (!bots.length) {
      bots = fresh.map(b => saveBot(b));
    } else {
      if (this.config.guideBot && !bots.some(b => b.id === 'guide')) {
        const guide = fresh.find(b => b.id === 'guide');
        if (guide) bots.push(saveBot(guide));
      }
      // Existing installs receive tools added to the built-in bots since they were created.
      bots = bots.map(bot => {
        const upgraded = upgradeBuiltinBot(bot, fresh.find(f => f.id === bot.id) ?? bot);
        return upgraded === bot ? bot : saveBot(upgraded);
      });
    }
    this.bots = new Map(bots.map(b => [b.id, b]));
    this.emit('bots', bots);
    return bots;
  }

  listBots(): Bot[] {
    return [...this.bots.values()].filter(b => b.id !== 'guide' || this.config.guideBot);
  }

  getBot(id: string): Bot | undefined {
    return this.bots.get(id);
  }

  upsertBot(bot: Bot): Bot {
    const saved = saveBot(bot);
    this.bots.set(saved.id, saved);
    this.emit('bots', this.listBots());
    return saved;
  }

  reloadSkills(): Skill[] {
    this.skills = loadSkills();
    return this.skills;
  }

  /** Always reads the skills folders, so skills added by a bot, by hand or by another process show up at once. */
  listSkills(): Skill[] {
    return this.reloadSkills();
  }

  reloadWorkflows(): { workflows: Workflow[]; errors: Record<string, string>; nextRuns: Record<string, string | null> } {
    const loaded = loadWorkflows();
    this.workflows = loaded.workflows;
    this.workflowErrors = loaded.errors;
    this.scheduler.reload(this.workflows);
    return { workflows: this.workflows, errors: this.workflowErrors, nextRuns: this.scheduler.nextRuns() };
  }

  listWorkflows() {
    return { workflows: this.workflows, errors: this.workflowErrors, nextRuns: this.scheduler.nextRuns() };
  }

  findCommandWorkflow(command: string): Workflow | undefined {
    return this.workflows.find(w => w.trigger.type === 'command' && w.trigger.command === command);
  }

  async runWorkflow(workflow: Workflow, reason: string): Promise<ChatResult> {
    const result = await this.chat({
      botId: workflow.bot,
      chatKey: `workflow:${workflow.name}`,
      channel: 'workflow',
      text: workflow.prompt,
      approvalOverride: workflow.approval === 'inherit' ? undefined : workflow.approval,
      fresh: workflow.freshSession,
    });
    const header = `Workflow ${workflow.name} (${reason})`;
    for (const target of workflow.deliver) {
      await this.sendMessage(target.channel, target.chatId, `${header}\n\n${result.error ? `Failed: ${result.error}` : result.text}`).catch(error => {
        console.error(`Delivery to ${target.channel}:${target.chatId} failed: ${(error as Error).message}`);
      });
    }
    return result;
  }

  // ---- channels ------------------------------------------------------------

  registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.id, adapter);
  }

  unregisterChannel(id: string): void {
    this.channels.delete(id);
  }

  channelIds(): string[] {
    return [...this.channels.keys()];
  }

  async sendMessage(channel: string, chatId: string, text: string): Promise<void> {
    const adapter = this.channels.get(channel);
    if (!adapter) throw new Error(`Channel "${channel}" is not connected. Connected: ${this.channelIds().join(', ') || 'none'}.`);
    await adapter.send(chatId, text);
  }

  // ---- chat ----------------------------------------------------------------

  async chat(input: ChatInput): Promise<ChatResult> {
    const bot = this.bots.get(input.botId);
    if (!bot) throw new Error(`Unknown bot "${input.botId}".`);
    const session = this.store.getOrCreateSession(bot.id, input.chatKey, input.channel);
    if (input.fresh) this.store.resetSession(session.id);
    const previous = this.runs.get(session.id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.execute(bot, session, input));
    this.runs.set(session.id, run);
    try {
      return await run;
    } finally {
      if (this.runs.get(session.id) === run) this.runs.delete(session.id);
    }
  }

  abort(sessionId: string): boolean {
    const agent = this.active.get(sessionId);
    if (!agent) return false;
    agent.abort();
    return true;
  }

  private async execute(bot: Bot, session: SessionRow, input: ChatInput): Promise<ChatResult> {
    const runId = `${Date.now().toString(36)}-${++this.runCounter}`;
    const emit = (event: ChatEvent) => {
      input.onEvent?.(event);
      this.emit('chat', event);
    };
    emit({ type: 'start', runId, botId: bot.id, chatKey: input.chatKey, sessionId: session.id });
    const fail = (message: string): ChatResult => {
      emit({ type: 'error', runId, message });
      return { runId, sessionId: session.id, text: '', costUsd: 0, error: message };
    };
    if (bot.budgetUsd > 0 && this.store.monthlyCost(bot.id) >= bot.budgetUsd) {
      return fail(`${bot.name} reached its monthly budget of $${bot.budgetUsd.toFixed(2)}. Raise it in the bot settings to continue.`);
    }
    const model = this.registry.getModel(bot.model.provider, bot.model.id);
    if (!model) return fail(`Model ${bot.model.provider}/${bot.model.id} is not available. Pick another model for ${bot.name} in the web UI.`);
    const auth = await this.registry.checkAuth(bot.model.provider);
    if (!auth) return fail(`Provider "${bot.model.provider}" has no API key. Add one under Settings → Providers.`);

    const workdir = bot.workdir ?? this.config.workdir;
    fs.mkdirSync(workdir, { recursive: true });
    this.reloadSkills();
    const tools = this.toolsFor(bot, { botId: bot.id, chatKey: input.chatKey, channel: input.channel, workdir });
    const history = this.store.loadMessages<Message>(session.id).filter(m => m.role !== 'system');
    let seq = this.store.messageCount(session.id);
    let toolWork = 0;
    let savedSkill = false;
    const agent = new Agent({
      initialState: { systemPrompt: this.systemPrompt(bot, tools, input.channel, workdir), model, tools, messages: history, thinkingLevel: bot.thinking },
      streamFn: this.registry.streamFn,
      sessionId: session.id,
      toolExecution: 'sequential',
      identity: { attribution: null },
      beforeToolCall: (ctx, signal) => this.gate(bot, tools, input, ctx, signal),
    });
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let errorMessage: string | undefined;
    agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent.type === 'text_delta') emit({ type: 'delta', runId, text: event.assistantMessageEvent.delta });
          break;
        case 'message_end': {
          // Save every finished message at once, so a crash, restart or lost connection never loses the conversation.
          const finished = event.message;
          if (finished.role === 'user' || finished.role === 'assistant' || finished.role === 'toolResult') {
            this.store.appendMessage(session.id, seq++, finished);
            if (finished.role === 'user') this.store.setTitleIfEmpty(session.id, titleFrom(input.text));
          }
          if (event.message.role === 'assistant') {
            const m = event.message as AssistantMessage;
            cost += m.usage.cost.total;
            inputTokens += m.usage.input;
            outputTokens += m.usage.output;
            this.store.addUsage({ botId: bot.id, sessionId: session.id, provider: m.provider, model: m.model, input: m.usage.input, output: m.usage.output, cost: m.usage.cost.total });
            if (m.stopReason === 'error' || m.stopReason === 'aborted') errorMessage = m.errorMessage ?? m.stopReason;
          }
          break;
        }
        case 'tool_execution_start':
          emit({ type: 'tool_start', runId, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
          break;
        case 'tool_execution_end':
          if (!event.isError) {
            if (!NOT_WORK.has(event.toolName)) toolWork++;
            if (event.toolName === 'save_skill') savedSkill = true;
          }
          emit({ type: 'tool_end', runId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, output: resultText(event.result).slice(0, 2000) });
          break;
        default:
          break;
      }
    });
    this.active.set(session.id, agent);
    try {
      await agent.prompt(input.text);
    } catch (error) {
      errorMessage = (error as Error).message;
    } finally {
      this.active.delete(session.id);
    }
    const messages = agent.state.messages.filter(m => m.role !== 'system');
    const text = lastAssistantText(messages);
    if (errorMessage && !text) return fail(errorMessage);
    emit({ type: 'done', runId, text, costUsd: cost, inputTokens, outputTokens });
    if (!errorMessage) this.maybeLearn(bot, session, input, toolWork, savedSkill);
    return { runId, sessionId: session.id, text, costUsd: cost, error: errorMessage };
  }

  // ---- slash commands --------------------------------------------------------

  /**
   * Handle a chat message that is a known slash command. Returns null for anything else, which then goes to
   * the model, so a path like /etc/hosts or an unknown /word is never swallowed.
   */
  async command(text: string, ctx: { botId: string; chatKey: string }): Promise<CommandOutcome | null> {
    const m = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!m) return null;
    const name = (m[1] ?? '').toLowerCase();
    const arg = (m[2] ?? '').trim();
    if (!COMMAND_NAMES.has(name)) {
      const workflow = this.findCommandWorkflow(name);
      if (!workflow) return null;
      const result = await this.runWorkflow(workflow, `command:/${name}`);
      return { reply: result.error ? `Failed: ${result.error}` : result.text || '(no output)' };
    }
    switch (name) {
      case 'help': return { reply: COMMAND_HELP };
      case 'bots': return { reply: this.listBots().map(b => `${b.emoji} ${b.name} — /bot ${b.id}${b.id === ctx.botId ? '  (current)' : ''}`).join('\n') };
      case 'bot': {
        const wanted = arg.toLowerCase();
        const target = this.listBots().find(b => b.id === wanted || b.name.toLowerCase() === wanted);
        if (!target) return { reply: `${arg ? `No bot called "${arg}".` : 'Say which bot.'} Available: ${this.listBots().map(b => b.id).join(', ')}` };
        return { reply: `${target.emoji} Switched to ${target.name}.`, switchBot: target.id };
      }
      case 'new': return { reply: 'Started a new conversation. The previous one is kept in your list.', newConversation: true };
      case 'skills': {
        const skills = this.listSkills();
        return { reply: skills.length ? skills.map(s => `• ${s.name} — ${s.description.slice(0, 110)}`).join('\n') : 'No skills yet. Finish a multi-step task, then use /learn.' };
      }
      case 'usage': {
        const rows = this.usage();
        const total = rows.reduce((sum, r) => sum + r.cost, 0);
        return { reply: rows.length ? `${rows.map(r => `${r.botId}: $${r.cost.toFixed(4)} · ${r.requests} requests`).join('\n')}\nTotal this month: $${total.toFixed(4)}` : 'No usage recorded this month.' };
      }
      case 'status': return { reply: this.describeCapabilities() };
      case 'learn': {
        const result = await this.learnFrom(ctx.botId, ctx.chatKey, { hint: arg || undefined });
        return { reply: result.message };
      }
      default: return null;
    }
  }

  // ---- skill learning --------------------------------------------------------

  private track(promise: Promise<unknown>): void {
    const tracked = promise.catch(() => undefined).finally(() => this.background.delete(tracked));
    this.background.add(tracked);
  }

  /** Resolves when background work (skill reviews and the approvals they wait on) has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.background.size) await Promise.allSettled([...this.background]);
  }

  private maybeLearn(bot: Bot, session: SessionRow, input: ChatInput, toolWork: number, savedSkill: boolean): void {
    if (!this.config.learning.auto || input.channel === 'workflow' || savedSkill) return;
    if (toolWork < this.config.learning.minToolCalls) return;
    if (bot.tools !== '*' && !bot.tools.includes('save_skill')) return;
    if (Date.now() - (this.lastLearn.get(session.id) ?? 0) < LEARN_COOLDOWN_MS) return;
    this.lastLearn.set(session.id, Date.now());
    this.track(this.learnFrom(bot.id, input.chatKey, { channel: input.channel }).catch(error => console.error(`Skill review failed: ${(error as Error).message}`)));
  }

  /**
   * Review a conversation and, if it holds a reusable procedure, ask the human to approve saving it as a skill.
   * The suggestion appears wherever approvals appear (web, phone, Telegram, Discord) and lives for six hours.
   */
  async learnFrom(botId: string, chatKey: string, opts: { hint?: string; channel?: string } = {}): Promise<{ proposed?: SkillProposal; message: string }> {
    const bot = this.bots.get(botId);
    if (!bot) return { message: `Unknown bot "${botId}".` };
    const session = this.store.findSession(botId, chatKey);
    const messages = session ? this.store.loadMessages<Message>(session.id).filter(m => m.role !== 'system') : [];
    if (!session || !messages.length) return { message: 'There is nothing in this conversation to learn from yet.' };
    const model = this.registry.getModel(bot.model.provider, bot.model.id);
    if (!model || !(await this.registry.checkAuth(bot.model.provider))) return { message: `${bot.name}'s model is not available, so I cannot review this conversation.` };
    this.reloadSkills();
    let digest = buildDigest(messages, this.skills.map(s => s.name));
    if (opts.hint) digest += `\n\nThe user asked to save this: ${opts.hint}`;
    const reply = await this.registry.models.completeSimple(model, { systemPrompt: REFLECT_SYSTEM, messages: [{ role: 'user', content: digest, timestamp: Date.now() }] });
    this.store.addUsage({ botId: bot.id, sessionId: session.id, provider: reply.provider, model: reply.model, input: reply.usage.input, output: reply.usage.output, cost: reply.usage.cost.total });
    if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return { message: `Could not review this conversation: ${reply.errorMessage ?? reply.stopReason}` };
    const parsed = parseProposal(reply.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join(''));
    if ('reason' in parsed) return { message: parsed.reason };
    const { proposal } = parsed;
    const exists = this.skills.some(s => s.name === proposal.name);
    this.track(this.approvals.request({
      botId: bot.id, botName: bot.name, chatKey, channel: opts.channel ?? 'web', toolName: 'save_skill', category: 'self-modify',
      summary: `${exists ? 'Update' : 'Learn'} skill "${proposal.name}": ${proposal.description.slice(0, 140)}`, args: proposal,
    }, undefined, SKILL_PROPOSAL_LIFETIME_MS).then(resolved => {
      if (resolved.decision !== 'allow') return;
      writeUserSkill(proposal.name, proposal.description, proposal.body);
      this.reloadSkills();
      this.emit('skill_learned', proposal.name);
    }));
    return { proposed: proposal, message: `Suggested skill "${proposal.name}": ${proposal.description}\nApprove it under Approvals (web, phone or chat) to save it. It is only saved if you say yes.` };
  }

  private toolsFor(bot: Bot, ctx: { botId: string; chatKey: string; channel: string; workdir: string }): SwitchboardTool[] {
    const all = buildTools({ ...ctx, services: this.services(bot) });
    if (bot.tools === '*') return all;
    const wanted = new Set(bot.tools);
    return all.filter(t => wanted.has(t.name));
  }

  private services(bot: Bot): ToolServices {
    return {
      skills: () => (bot.skills === '*' ? this.skills : this.skills.filter(s => (bot.skills as string[]).includes(s.name))),
      skillsChanged: () => { this.reloadSkills(); },
      sendMessage: (channel, chatId, text) => this.sendMessage(channel, chatId, text),
      scheduleWorkflow: async input => {
        if (!this.bots.has(input.bot)) throw new Error(`Unknown bot "${input.bot}".`);
        const yaml = workflowToYaml({
          name: input.name, cron: input.cron, bot: input.bot, prompt: input.prompt,
          deliver: input.deliverChannel && input.deliverChatId ? [{ channel: input.deliverChannel, chatId: input.deliverChatId }] : [],
        });
        const saved = saveWorkflowYaml(input.name, yaml);
        this.reloadWorkflows();
        return saved.file;
      },
      describeCapabilities: () => this.describeCapabilities(),
    };
  }

  private async gate(bot: Bot, tools: SwitchboardTool[], input: ChatInput, ctx: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined> {
    const tool = tools.find(t => t.name === ctx.toolCall.name);
    const category: ToolCategory = tool?.category ?? 'shell';
    let mode = effectivePolicy(bot, category);
    if (mode === 'ask' && input.approvalOverride === 'auto') mode = 'auto';
    if (mode === 'ask' && input.approvalOverride === 'never') mode = 'never';
    if (mode === 'auto') return undefined;
    if (mode === 'never') return { block: true, reason: `Tools in the "${category}" category are disabled for ${bot.name}.` };
    const resolved = await this.approvals.request({
      botId: bot.id, botName: bot.name, chatKey: input.chatKey, channel: input.channel,
      toolName: ctx.toolCall.name, category, summary: summarizeToolCall(ctx.toolCall.name, ctx.args), args: ctx.args,
    }, signal);
    if (resolved.decision === 'allow') return undefined;
    const reason = resolved.decision === 'deny' ? `The user denied this ${ctx.toolCall.name} call.`
      : resolved.decision === 'timeout' ? 'Nobody approved this call in time; it was not run.'
        : 'The run was aborted.';
    return { block: true, reason, terminate: resolved.decision !== 'deny' };
  }

  private systemPrompt(bot: Bot, tools: SwitchboardTool[], channel: string, workdir: string): string {
    const toolLines = tools.map(t => `- ${t.name} [${t.category}, ${effectivePolicy(bot, t.category)}]`).join('\n') || '- (no tools)';
    const skills = bot.skills === '*' ? this.skills : this.skills.filter(s => (bot.skills as string[]).includes(s.name));
    const sections = [
      bot.systemPrompt.trim(),
      `## Environment\n- You are "${bot.name}" (id ${bot.id}) in Switchboard ${VERSION}.\n- Channel: ${channel}. Working directory: ${workdir}. Platform: ${os.platform()}.\n- Date: ${new Date().toISOString().slice(0, 10)}.\n- Tool calls marked "ask" pause until a human approves them, possibly from a phone. Keep such calls purposeful and explain them in one line before calling.\n\n## Tools (category, approval)\n${toolLines}`,
    ];
    if (tools.some(t => t.name === 'load_skill')) sections.push(`## Skills\nLoad a skill with load_skill when a task matches its description, before you start the task.\n${skillsManifest(skills)}`);
    if (tools.some(t => t.name === 'save_skill')) {
      sections.push('## Learning\nWhen you finish a multi-step task the user may want again, or you worked out something specific to this user\'s setup through trial and error, save it: call save_skill with a short kebab-case name, a description saying what it does and when to use it, and numbered steps with the exact commands, paths and pitfalls. Do not save one-off answers or general knowledge. When a loaded skill turns out wrong or incomplete, fix it by calling save_skill with the same name. The user approves new skills, so just do it and say what you saved.');
    }
    const memory = memoryPromptSection(bot.id, bot.memory && tools.some(t => t.name === 'remember'));
    if (memory) sections.push(memory);
    return sections.join('\n\n');
  }

  describeCapabilities(): string {
    const bots = this.listBots().map(b => `- ${b.emoji} ${b.name} (${b.id}): ${b.description || 'no description'}; model ${b.model.provider}/${b.model.id}; tools ${b.tools === '*' ? 'all' : b.tools.join(', ') || 'none'}`);
    const providers = Object.entries(this.config.providers).map(([id, p]) => `- ${id}${p.apiKey ? ' (key set)' : ''}${p.baseUrl ? ` at ${p.baseUrl}` : ''}`);
    const channels = this.channelIds();
    const workflows = this.workflows.map(w => `- ${w.name}: ${w.trigger.type}${w.trigger.type === 'cron' ? ` ${w.trigger.expression}` : w.trigger.type === 'command' ? ` /${w.trigger.command}` : ''} → bot ${w.bot}`);
    return [
      `Switchboard ${VERSION} on ${os.platform()}. Local API at http://${this.config.server.host}:${this.config.server.port}.`,
      `Bots:\n${bots.join('\n') || '- none'}`,
      `Providers configured:\n${providers.join('\n') || '- none yet (Settings → Providers)'}`,
      `Connected channels: ${channels.join(', ') || 'none (Settings → Channels to add Telegram or Discord)'}`,
      `Paired phones: ${this.config.devices.length}`,
      `Skills installed:\n${skillsManifest(this.skills)}`,
      `Workflows:\n${workflows.join('\n') || '- none (Workflows tab or ask a bot to schedule one)'}`,
      `Tool categories and default approval: read auto; write, shell, network, messaging and self-modify ask. Each bot can change this in its policy. Approvals time out after ${this.config.approvalTimeoutSec}s and are then denied.`,
      'How to use: chat with a bot in the web UI, the phone app, Telegram or Discord. Slash commands work everywhere: /help lists them (/bot <id> switches bot, /new starts a new conversation, /skills lists skills, /learn suggests a skill from the current conversation). Approve tool calls from any surface, or choose "always allow" for a tool category.',
      `Skill learning: ${this.config.learning.auto ? `after a run with ${this.config.learning.minToolCalls} or more tool calls, the bot's model reviews the conversation and may suggest a skill; you approve it before it is saved.` : 'automatic suggestions are off; use /learn.'}`,
    ].join('\n\n');
  }

  pairingInfo(): { urls: string[]; candidates: PairingCandidate[]; token: string; host: string; port: number } {
    const port = this.config.server.port;
    const host = this.config.server.host;
    const candidates = host === '0.0.0.0' || host === '::'
      ? rankPairingCandidates(os.networkInterfaces(), port)
      : [{ url: `http://${host}:${port}`, address: host, adapter: 'configured host', kind: 'lan' as const, note: host === '127.0.0.1' ? 'Loopback only: phones cannot reach this. Set Server host to 0.0.0.0 in Settings → General and restart.' : '' }];
    return { urls: candidates.map(c => c.url), candidates, token: this.config.token, host, port };
  }

  usage() {
    return this.store.monthlyUsage();
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop();
    this.approvals.clear();
    for (const agent of this.active.values()) agent.abort();
    for (const channel of this.channels.values()) await channel.stop().catch(() => undefined);
    this.store.close();
  }
}

export interface PairingCandidate {
  url: string;
  address: string;
  adapter: string;
  /** lan = Wi-Fi or Ethernet; vpn = Tailscale or similar; virtual = hypervisor or container adapters phones cannot reach. */
  kind: 'lan' | 'vpn' | 'virtual';
  note: string;
}

const VIRTUAL_ADAPTER = /vEthernet|Hyper-V|WSL|Docker|VirtualBox|VMware|vmnet|Loopback|Npcap|Bluetooth/i;
const VPN_ADAPTER = /Tailscale|ZeroTier|WireGuard|OpenVPN|NordLynx|Hamachi|tun\d|utun/i;

/** Order network addresses for phone pairing: Wi-Fi and Ethernet first, VPNs next, hypervisor adapters last. */
export function rankPairingCandidates(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, port: number): PairingCandidate[] {
  const out: PairingCandidate[] = [];
  for (const [adapter, list] of Object.entries(interfaces)) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const kind: PairingCandidate['kind'] = VIRTUAL_ADAPTER.test(adapter) ? 'virtual'
        : VPN_ADAPTER.test(adapter) || iface.address.startsWith('100.') ? 'vpn' : 'lan';
      const note = kind === 'lan' ? 'Same Wi-Fi or Ethernet as the phone.'
        : kind === 'vpn' ? 'Works from anywhere when the phone runs the same VPN (for example Tailscale).'
          : 'Virtual adapter on this computer only; phones cannot reach it.';
      out.push({ url: `http://${iface.address}:${port}`, address: iface.address, adapter, kind, note });
    }
  }
  const rank = { lan: 0, vpn: 1, virtual: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.adapter.localeCompare(b.adapter));
}

function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

function resultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
}

function lastAssistantText(messages: { role: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant') {
      const content = (m as AssistantMessage).content;
      const text = content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('').trim();
      if (text) return text;
    }
  }
  return '';
}

export function sessionsDir(): string {
  return path.join(os.homedir(), '.switchboard');
}
