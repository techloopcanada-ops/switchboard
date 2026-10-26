import { DiscordChannel } from './channels/discord.ts';
import { TelegramChannel } from './channels/telegram.ts';
import type { Config } from './config.ts';
import { sendPush } from './push.ts';
import { Switchboard, VERSION, type ChannelAdapter } from './runtime.ts';
import { createServer, listen, type ServerHandle } from './server.ts';

export interface App {
  sb: Switchboard;
  server: ServerHandle;
  url: string;
  /** Disconnect Telegram and Discord without stopping the daemon (bots stay reachable from the UI and phone). */
  pauseChannels(): Promise<void>;
  /** Reconnect channels from the current config. */
  resumeChannels(): Promise<void>;
  channelsPaused(): boolean;
  stop(): Promise<void>;
}

/** Composition root: runtime + channels + push + API server. Used by the CLI and the desktop shell. */
export async function startSwitchboard(options: { webDir?: string; log?: (line: string) => void } = {}): Promise<App> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sb = await Switchboard.create();
  const channels = new Map<string, ChannelAdapter>();
  let paused = false;

  async function stopChannels(): Promise<void> {
    for (const [id, adapter] of [...channels]) {
      await adapter.stop().catch(() => undefined);
      sb.unregisterChannel(id);
      channels.delete(id);
    }
  }

  async function syncChannels(config: Config): Promise<void> {
    await stopChannels();
    if (paused) return;
    const wanted: Record<string, () => ChannelAdapter> = {};
    if (config.telegram?.token) wanted.telegram = () => new TelegramChannel(sb, config.telegram!.token);
    if (config.discord?.token) wanted.discord = () => new DiscordChannel(sb, config.discord!.token);
    for (const [id, make] of Object.entries(wanted)) {
      try {
        const adapter = make();
        await adapter.start();
        sb.registerChannel(adapter);
        channels.set(id, adapter);
        log(`Channel ${id}: started`);
      } catch (error) {
        log(`Channel ${id}: failed to start (${(error as Error).message})`);
      }
    }
  }

  sb.on('approval', request => {
    if (!sb.config.devices.length) return;
    sendPush(sb.config.devices, { title: `${request.botName} needs approval`, body: request.summary, data: { approvalId: request.id, kind: 'approval' } })
      .then(r => { for (const e of r.errors) log(`Push: ${e}`); })
      .catch(error => log(`Push failed: ${(error as Error).message}`));
  });

  const server = createServer(sb, { webDir: options.webDir, onConfigChanged: syncChannels });
  await listen(server, sb.config.server.host, sb.config.server.port);
  await syncChannels(sb.config);
  log(`Switchboard ${VERSION} listening at ${server.url}`);
  return {
    sb,
    server,
    url: server.url,
    async pauseChannels() {
      paused = true;
      await stopChannels();
      log('Channels paused');
    },
    async resumeChannels() {
      paused = false;
      await syncChannels(sb.config);
    },
    channelsPaused: () => paused,
    async stop() {
      await server.close();
      await sb.shutdown();
    },
  };
}
