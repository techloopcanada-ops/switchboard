import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits, Partials,
  type Interaction, type Message, type TextBasedChannel,
} from 'discord.js';
import type { ApprovalRequest, ApprovalResolved } from '../approvals.ts';
import type { ChannelAdapter, Switchboard } from '../runtime.ts';

const MAX_LEN = 1900;

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
 * Discord gateway over the official websocket API (outbound only). Responds to DMs and to
 * mentions in servers. Requires the Message Content intent in the Developer Portal.
 */
export class DiscordChannel implements ChannelAdapter {
  readonly id = 'discord';
  private readonly client: Client;
  private readonly sb: Switchboard;
  private readonly token: string;
  private readonly chatBots = new Map<string, string>();
  private readonly approvalMessages = new Map<string, Message>();

  constructor(sb: Switchboard, token: string) {
    this.sb = sb;
    this.token = token;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
    });
    this.client.on(Events.ClientReady, c => console.log(`Discord connected as ${c.user.tag}`));
    this.client.on(Events.MessageCreate, message => { this.handleMessage(message).catch(error => console.error('Discord error:', (error as Error).message)); });
    this.client.on(Events.InteractionCreate, interaction => { this.handleInteraction(interaction).catch(error => console.error('Discord error:', (error as Error).message)); });
  }

  private allowed(userId: string): boolean {
    return (this.sb.config.discord?.allowedUserIds ?? []).includes(userId);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    const me = this.client.user?.id;
    const isDm = !message.guild;
    const mentioned = me ? message.mentions.users.has(me) : false;
    if (!isDm && !mentioned) return;
    if (!this.allowed(message.author.id)) {
      await message.reply(`Not allowed. Your Discord user id is ${message.author.id}. Add it under Settings → Channels in Switchboard.`);
      return;
    }
    const text = message.content.replace(me ? new RegExp(`<@!?${me}>`, 'g') : /$^/, '').trim();
    const chatId = message.channel.id;
    if (text.startsWith('/')) {
      const [command, ...rest] = text.slice(1).split(/\s+/);
      if (command === 'bots') { await message.reply(this.sb.listBots().map(b => `${b.emoji} ${b.name} — /bot ${b.id}`).join('\n')); return; }
      if (command === 'bot') {
        const bot = this.sb.getBot(rest[0] ?? '');
        if (!bot) { await message.reply(`Unknown bot. Available: ${this.sb.listBots().map(b => b.id).join(', ')}`); return; }
        this.chatBots.set(chatId, bot.id);
        await message.reply(`${bot.emoji} Switched to ${bot.name}.`);
        return;
      }
      if (command === 'new') {
        const session = this.sb.store.getOrCreateSession(this.currentBot(chatId), `discord:${chatId}`, 'discord');
        this.sb.store.resetSession(session.id);
        await message.reply('Fresh conversation started.');
        return;
      }
      if (command === 'status') { await message.reply(this.sb.describeCapabilities().slice(0, MAX_LEN)); return; }
      const workflow = this.sb.findCommandWorkflow(command ?? '');
      if (workflow) {
        await message.reply(`Running workflow ${workflow.name}…`);
        const result = await this.sb.runWorkflow(workflow, `discord:/${command}`);
        for (const part of chunk(result.error ? `Failed: ${result.error}` : result.text || '(no output)')) await message.reply(part);
        return;
      }
      await message.reply('Commands: /bots, /bot <id>, /new, /status, or a workflow command.');
      return;
    }
    const botId = this.currentBot(chatId);
    if (!this.sb.getBot(botId)) { await message.reply(`Bot "${botId}" does not exist. Use /bots.`); return; }
    if ('sendTyping' in message.channel) await message.channel.sendTyping().catch(() => undefined);
    const result = await this.sb.chat({ botId, chatKey: `discord:${chatId}`, channel: 'discord', text });
    const final = result.error && !result.text ? `Failed: ${result.error}` : result.text || '(no reply)';
    const parts = chunk(final);
    await message.reply(parts[0] ?? final);
    for (const part of parts.slice(1)) await this.sendTo(message.channel, part);
  }

  private currentBot(chatId: string): string {
    return this.chatBots.get(chatId) ?? this.sb.config.discord?.defaultBot ?? this.sb.config.defaultBot;
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;
    const [kind, decision, id] = interaction.customId.split(':');
    if (kind !== 'ap' || (decision !== 'allow' && decision !== 'deny') || !id) return;
    if (!this.allowed(interaction.user.id)) { await interaction.reply({ content: 'Not allowed.', ephemeral: true }); return; }
    const ok = this.sb.approvals.decide(id, decision, `discord:${interaction.user.id}`);
    await interaction.reply({ content: ok ? (decision === 'allow' ? 'Approved.' : 'Denied.') : 'Already decided or expired.', ephemeral: true });
  }

  private async sendTo(channel: TextBasedChannel, text: string, components?: ActionRowBuilder<ButtonBuilder>[]): Promise<Message | undefined> {
    if (!('send' in channel)) return undefined;
    return channel.send(components ? { content: text, components } : { content: text });
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async send(chatId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !channel.isTextBased()) throw new Error(`Discord channel ${chatId} is not a text channel.`);
    for (const part of chunk(text)) await this.sendTo(channel, part);
  }

  async notifyApproval(request: ApprovalRequest): Promise<void> {
    if (request.channel !== 'discord' || !request.chatKey.startsWith('discord:')) return;
    const channel = await this.client.channels.fetch(request.chatKey.slice('discord:'.length)).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ap:allow:${request.id}`).setLabel('Allow').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ap:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
    const message = await this.sendTo(channel, `**Approval needed · ${request.botName}**\n${request.summary}\ncategory: ${request.category}`, [row]);
    if (message) this.approvalMessages.set(request.id, message);
  }

  async notifyResolved(resolved: ApprovalResolved): Promise<void> {
    const message = this.approvalMessages.get(resolved.id);
    if (!message) return;
    this.approvalMessages.delete(resolved.id);
    const label = resolved.decision === 'allow' ? '✅ Approved' : resolved.decision === 'deny' ? '⛔ Denied' : `⌛ ${resolved.decision}`;
    await message.edit({ content: `${label} · ${resolved.botName}\n${resolved.summary}\nby ${resolved.decidedBy}`, components: [] }).catch(() => undefined);
  }
}
