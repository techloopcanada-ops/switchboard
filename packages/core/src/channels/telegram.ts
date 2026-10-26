import { Bot as TelegramBot, InlineKeyboard, type Context } from 'grammy';
import type { ApprovalRequest, ApprovalResolved } from '../approvals.ts';
import { COMMAND_HELP, type ChannelAdapter, type Switchboard } from '../runtime.ts';

const MAX_LEN = 4000;

function chunk(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_LEN) {
    const cut = rest.lastIndexOf('\n', MAX_LEN);
    const at = cut > MAX_LEN / 2 ? cut : MAX_LEN;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  parts.push(rest);
  return parts;
}

/**
 * Telegram gateway using long polling: no public URL, no open ports.
 * Only user ids in config.telegram.allowedUserIds may talk to bots; /start shows a caller's id.
 */
export class TelegramChannel implements ChannelAdapter {
  readonly id = 'telegram';
  private readonly bot: TelegramBot;
  private readonly sb: Switchboard;
  private readonly chatBots = new Map<string, string>();
  private readonly approvalMessages = new Map<string, { chatId: string; messageId: number }>();
  private running = false;

  constructor(sb: Switchboard, token: string) {
    this.sb = sb;
    this.bot = new TelegramBot(token);
    this.bot.catch(err => console.error('Telegram error:', err.message));
    this.bot.command('start', ctx => this.handleStart(ctx));
    this.bot.command('help', ctx => ctx.reply(this.help()));
    this.bot.command('bots', ctx => this.guard(ctx, () => ctx.reply(this.sb.listBots().map(b => `${b.emoji} ${b.name} — /bot ${b.id}`).join('\n'))));
    this.bot.command('bot', ctx => this.guard(ctx, () => this.switchBot(ctx)));
    this.bot.command('new', ctx => this.guard(ctx, () => this.newSession(ctx)));
    this.bot.command('status', ctx => this.guard(ctx, () => ctx.reply(this.sb.describeCapabilities().slice(0, MAX_LEN))));
    this.bot.command('approvals', ctx => this.guard(ctx, () => this.listApprovals(ctx)));
    this.bot.on('callback_query:data', ctx => this.guard(ctx, () => this.handleCallback(ctx)));
    this.bot.on('message:text', ctx => this.guard(ctx, () => this.handleMessage(ctx)));
  }

  private help(): string {
    return `Commands:\n${COMMAND_HELP}\n/approvals — pending approvals\n\nWorkflows with a command trigger run as /<command>.`;
  }

  private allowed(ctx: Context): boolean {
    const id = ctx.from?.id;
    return id !== undefined && (this.sb.config.telegram?.allowedUserIds ?? []).includes(id);
  }

  private async guard(ctx: Context, fn: () => Promise<unknown> | unknown): Promise<void> {
    if (!this.allowed(ctx)) {
      await ctx.reply(`Not allowed. Your Telegram user id is ${ctx.from?.id ?? 'unknown'}. Add it under Settings → Channels in Switchboard, then try again.`);
      return;
    }
    await fn();
  }

  private async handleStart(ctx: Context): Promise<void> {
    if (!this.allowed(ctx)) {
      await ctx.reply(`Hello. Your Telegram user id is ${ctx.from?.id ?? 'unknown'}. Add it to the allowed list in Switchboard (Settings → Channels) to start chatting.`);
      return;
    }
    await ctx.reply(`Connected. Current bot: ${this.currentBot(ctx)}.\n\n${this.help()}`);
  }

  private currentBot(ctx: Context): string {
    const key = String(ctx.chat?.id);
    return this.chatBots.get(key) ?? this.sb.config.telegram?.defaultBot ?? this.sb.config.defaultBot;
  }

  private async switchBot(ctx: Context): Promise<void> {
    const id = (ctx.match as string | undefined)?.trim();
    const bot = id ? this.sb.getBot(id) : undefined;
    if (!bot) {
      await ctx.reply(`Unknown bot. Available: ${this.sb.listBots().map(b => b.id).join(', ')}`);
      return;
    }
    this.chatBots.set(String(ctx.chat?.id), bot.id);
    await ctx.reply(`${bot.emoji} Switched to ${bot.name}. Send a message to start.`);
  }

  private async newSession(ctx: Context): Promise<void> {
    this.sb.store.archiveSession(this.currentBot(ctx), `telegram:${ctx.chat?.id}`);
    await ctx.reply('Fresh conversation started. The previous one is kept and visible in the app.');
  }

  private async listApprovals(ctx: Context): Promise<void> {
    const pending = this.sb.approvals.list();
    if (!pending.length) {
      await ctx.reply('No pending approvals.');
      return;
    }
    for (const request of pending) await this.notifyApproval(request, String(ctx.chat?.id));
  }

  private async handleCallback(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data ?? '';
    const [kind, decision, id] = data.split(':');
    if (kind !== 'ap' || (decision !== 'allow' && decision !== 'deny') || !id) {
      await ctx.answerCallbackQuery();
      return;
    }
    const ok = this.sb.approvals.decide(id, decision, `telegram:${ctx.from?.id}`);
    await ctx.answerCallbackQuery({ text: ok ? (decision === 'allow' ? 'Approved' : 'Denied') : 'Already decided or expired' });
  }

  private async handleMessage(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? '';
    const chatId = String(ctx.chat?.id);
    if (text.startsWith('/')) {
      const command = text.slice(1).split(/\s+/)[0] ?? '';
      await ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined);
      const outcome = await this.sb.command(text, { botId: this.currentBot(ctx), chatKey: `telegram:${chatId}` });
      if (!outcome) {
        await ctx.reply(`Unknown command /${command}. ${this.help()}`);
        return;
      }
      for (const part of chunk(outcome.reply)) await ctx.reply(part);
      return;
    }
    const botId = this.currentBot(ctx);
    if (!this.sb.getBot(botId)) {
      await ctx.reply(`Bot "${botId}" does not exist. Use /bots.`);
      return;
    }
    await ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined);
    let draft = '';
    let sent: { messageId: number } | undefined;
    let lastEdit = 0;
    let editing: Promise<unknown> = Promise.resolve();
    const flush = (final: boolean) => {
      const now = Date.now();
      if (!final && now - lastEdit < 1500) return;
      lastEdit = now;
      const body = draft.slice(0, MAX_LEN) || (final ? '' : '…');
      editing = editing.then(async () => {
        if (!body) return;
        if (!sent) sent = { messageId: (await ctx.reply(body)).message_id };
        else await ctx.api.editMessageText(chatId, sent.messageId, body).catch(() => undefined);
      });
    };
    const result = await this.sb.chat({
      botId, chatKey: `telegram:${chatId}`, channel: 'telegram', text,
      onEvent: event => {
        if (event.type === 'delta') { draft += event.text; flush(false); }
        if (event.type === 'tool_start') ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined);
      },
    });
    await editing;
    const final = result.error && !result.text ? `Failed: ${result.error}` : result.text || '(no reply)';
    const parts = chunk(final);
    if (sent) {
      await ctx.api.editMessageText(chatId, sent.messageId, parts[0] ?? final).catch(() => undefined);
      for (const part of parts.slice(1)) await ctx.reply(part);
    } else {
      for (const part of parts) await ctx.reply(part);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    void this.bot.start({ onStart: info => console.log(`Telegram connected as @${info.username}`) }).catch(error => {
      this.running = false;
      console.error(`Telegram stopped: ${(error as Error).message}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.bot.stop();
  }

  async send(chatId: string, text: string): Promise<void> {
    for (const part of chunk(text)) await this.bot.api.sendMessage(chatId, part);
  }

  async notifyApproval(request: ApprovalRequest, onlyChatId?: string): Promise<void> {
    const targets = onlyChatId ? [onlyChatId] : this.approvalTargets(request);
    const keyboard = new InlineKeyboard().text('✅ Allow', `ap:allow:${request.id}`).text('⛔ Deny', `ap:deny:${request.id}`);
    const text = `Approval needed · ${request.botName}\n${request.summary}\n\ncategory: ${request.category} · expires ${new Date(request.expiresAt).toLocaleTimeString()}`;
    for (const chatId of targets) {
      const message = await this.bot.api.sendMessage(chatId, text, { reply_markup: keyboard }).catch(() => undefined);
      if (message) this.approvalMessages.set(`${request.id}:${chatId}`, { chatId, messageId: message.message_id });
    }
  }

  private approvalTargets(request: ApprovalRequest): string[] {
    if (request.channel === 'telegram' && request.chatKey.startsWith('telegram:')) return [request.chatKey.slice('telegram:'.length)];
    // Approvals from other surfaces go to every allowed user who has a private chat id equal to their user id.
    return (this.sb.config.telegram?.allowedUserIds ?? []).map(String);
  }

  async notifyResolved(resolved: ApprovalResolved): Promise<void> {
    const label = resolved.decision === 'allow' ? '✅ Approved' : resolved.decision === 'deny' ? '⛔ Denied' : `⌛ ${resolved.decision}`;
    for (const [key, ref] of [...this.approvalMessages]) {
      if (!key.startsWith(`${resolved.id}:`)) continue;
      this.approvalMessages.delete(key);
      await this.bot.api.editMessageText(ref.chatId, ref.messageId, `${label} · ${resolved.botName}\n${resolved.summary}\nby ${resolved.decidedBy}`).catch(() => undefined);
    }
  }
}
