#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { startSwitchboard } from './app.ts';
import { builtinBots, loadBots, saveBot } from './bots.ts';
import { configPath, homeDir, loadConfig, saveConfig } from './config.ts';
import { FEATURED_PROVIDERS, ModelRegistry } from './models.ts';
import { Switchboard, VERSION } from './runtime.ts';

const HELP = `Switchboard ${VERSION} — your bots, any model, every channel.

Usage:
  switchboard start            Run the daemon (API, web UI, channels, workflows)
  switchboard setup            Interactive first-time setup
  switchboard chat [bot]       Chat with a bot in the terminal
  switchboard pair             Show the phone pairing URL and token
  switchboard doctor           Check configuration and providers
  switchboard help

Files live in ${homeDir()} (override with SWITCHBOARD_HOME).`;

async function main(argv: string[]): Promise<void> {
  const [command = 'help', ...rest] = argv;
  switch (command) {
    case 'start': return start();
    case 'setup': return setup();
    case 'chat': return chat(rest[0]);
    case 'pair': return pair();
    case 'doctor': return doctor();
    case '--version': case '-v': console.log(VERSION); return;
    default: console.log(HELP);
  }
}

async function start(): Promise<void> {
  const app = await startSwitchboard();
  const stop = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  console.log(`Open ${app.url} in a browser. Press Ctrl+C to stop.`);
}

async function setup(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, fallback = '') => ((await rl.question(`${q}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback);
  try {
    const config = loadConfig();
    console.log(`\nSwitchboard setup. Config file: ${configPath()}\n`);
    console.log('1) Pick a model provider. OpenRouter gives one key for 300+ models; Ollama needs no key.');
    console.log(`   Featured: ${FEATURED_PROVIDERS.join(', ')}, ollama`);
    const provider = (await ask('Provider id', config.defaultModel?.provider ?? 'openrouter')).toLowerCase();
    if (provider === 'ollama' || provider === 'lmstudio' || provider === 'custom') {
      const baseUrl = await ask('OpenAI-compatible base URL', provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1');
      const apiKey = await ask('API key (leave empty if none)');
      config.providers[provider] = { kind: 'openai-compatible', name: provider, baseUrl, apiKey: apiKey || undefined };
    } else {
      const apiKey = await ask(`${provider} API key`);
      config.providers[provider] = { kind: 'builtin', apiKey: apiKey || config.providers[provider]?.apiKey };
    }
    const registry = new ModelRegistry();
    await registry.applyConfig(config);
    const errors: Record<string, string> = await registry.refresh([provider]).catch(() => ({}));
    if (errors[provider]) console.log(`   (model list refresh: ${errors[provider]})`);
    const models = registry.models.getModels(provider).slice(0, 12).map(m => m.id);
    if (models.length) console.log(`   Some models: ${models.join(', ')}`);
    const modelId = await ask('Default model id', config.defaultModel?.id ?? models[0] ?? '');
    if (!modelId) throw new Error('A default model id is required.');
    config.defaultModel = { provider, id: modelId };

    console.log('\n2) Telegram (optional). Create a bot with @BotFather and paste its token. Then message your bot /start to see your user id.');
    const tgToken = await ask('Telegram bot token (empty to skip)', config.telegram?.token ? '(keep)' : '');
    if (tgToken && tgToken !== '(keep)') {
      const ids = await ask('Allowed Telegram user ids, comma separated', (config.telegram?.allowedUserIds ?? []).join(','));
      config.telegram = { token: tgToken, allowedUserIds: ids.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0) };
    }
    const workdir = await ask('Working directory for bots', config.workdir);
    config.workdir = workdir;
    saveConfig(config);
    if (!loadBots().length) for (const bot of builtinBots(config.defaultModel)) saveBot(bot);
    else for (const bot of loadBots()) if (bot.builtin) saveBot({ ...bot, model: config.defaultModel });
    console.log(`\nSaved. Start with: switchboard start\nThen open http://${config.server.host}:${config.server.port}\n`);
  } finally {
    rl.close();
  }
}

async function chat(botId?: string): Promise<void> {
  const sb = await Switchboard.create();
  const bot = sb.getBot(botId ?? sb.config.defaultBot) ?? sb.listBots()[0];
  if (!bot) throw new Error('No bots configured. Run: switchboard setup');
  sb.approvals.on('created', request => {
    console.log(`\n[approval needed] ${request.summary}`);
    rl.question('Allow? (y/N) ').then(answer => sb.approvals.decide(request.id, /^y/i.test(answer) ? 'allow' : 'deny', 'cli')).catch(() => undefined);
  });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log(`${bot.emoji} ${bot.name} (${bot.model.provider}/${bot.model.id}). Type /quit to exit, /new for a fresh session.`);
  for (;;) {
    const line = (await rl.question('> ')).trim();
    if (!line) continue;
    if (line === '/quit') break;
    const fresh = line === '/new';
    const result = await sb.chat({
      botId: bot.id, chatKey: 'cli:default', channel: 'cli', text: fresh ? 'Hello' : line, fresh,
      onEvent: event => {
        if (event.type === 'delta') stdout.write(event.text);
        if (event.type === 'tool_start') stdout.write(`\n[${event.toolName}] `);
        if (event.type === 'tool_end') stdout.write(event.isError ? '✗\n' : '✓\n');
      },
    });
    stdout.write('\n');
    if (result.error) console.log(`[error] ${result.error}`);
    if (result.costUsd) console.log(`[cost $${result.costUsd.toFixed(4)}]`);
  }
  rl.close();
  await sb.shutdown();
}

async function pair(): Promise<void> {
  const config = loadConfig();
  console.log(JSON.stringify({ urls: [`http://${config.server.host}:${config.server.port}`], token: config.token, note: 'Bind server.host to 0.0.0.0 to pair over LAN; use the web UI Pair tab for a QR code.' }, null, 2));
}

async function doctor(): Promise<void> {
  const config = loadConfig();
  const [major] = process.versions.node.split('.').map(Number);
  console.log(`Node ${process.versions.node} ${major !== undefined && major >= 22 ? '✓' : '✗ (need 22.19+)'}`);
  console.log(`Config: ${configPath()}`);
  console.log(`Default model: ${config.defaultModel ? `${config.defaultModel.provider}/${config.defaultModel.id}` : '✗ not set (run setup)'}`);
  const registry = new ModelRegistry();
  await registry.applyConfig(config);
  for (const id of Object.keys(config.providers)) {
    const auth = await registry.checkAuth(id);
    console.log(`Provider ${id}: ${auth ? `✓ (${auth.source ?? 'configured'})` : '✗ no credentials'}`);
  }
  console.log(`Telegram: ${config.telegram?.token ? `✓ ${config.telegram.allowedUserIds.length} allowed user(s)` : 'not configured'}`);
  console.log(`Discord: ${config.discord?.token ? `✓ ${config.discord.allowedUserIds.length} allowed user(s)` : 'not configured'}`);
  console.log(`Bots: ${loadBots().map(b => b.id).join(', ') || 'none (created on first start)'}`);
  console.log(`Paired phones: ${config.devices.length}`);
}

main(process.argv.slice(2)).catch(error => {
  console.error((error as Error).message);
  process.exit(1);
});
