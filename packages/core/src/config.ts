import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Root folder for everything Switchboard stores. Override with SWITCHBOARD_HOME. */
export function homeDir(): string {
  return process.env.SWITCHBOARD_HOME ?? path.join(homedir(), '.switchboard');
}

export interface ProviderConfig {
  /** Built-in pi-ai provider id (openai, anthropic, openrouter, ...) or a custom id for OpenAI-compatible servers. */
  kind: 'builtin' | 'openai-compatible';
  name?: string;
  apiKey?: string;
  /** Required for openai-compatible providers, e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl?: string;
}

export interface TelegramConfig {
  token: string;
  /** Telegram numeric user ids allowed to talk to bots. Empty list = nobody. */
  allowedUserIds: number[];
  defaultBot?: string;
}

export interface DiscordConfig {
  token: string;
  allowedUserIds: string[];
  defaultBot?: string;
}

export interface PushDevice {
  id: string;
  name: string;
  expoPushToken: string;
  addedAt: number;
}

export interface Config {
  version: 1;
  server: { host: string; port: number };
  /** Bearer token for the local API, the web UI and paired phones. */
  token: string;
  providers: Record<string, ProviderConfig>;
  defaultModel?: { provider: string; id: string };
  defaultBot: string;
  approvalTimeoutSec: number;
  guideBot: boolean;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  devices: PushDevice[];
  /** Default working directory for bots' file and shell tools. */
  workdir: string;
  /** Owner's referral codes. Keys are programme ids from referrals.ts. */
  referralCodes: Record<string, string>;
}

export function defaultConfig(): Config {
  return {
    version: 1,
    server: { host: '127.0.0.1', port: 7787 },
    token: randomBytes(24).toString('base64url'),
    providers: {},
    defaultBot: 'assistant',
    approvalTimeoutSec: 300,
    guideBot: true,
    devices: [],
    workdir: path.join(homeDir(), 'workspace'),
    referralCodes: {},
  };
}

export function configPath(): string {
  return path.join(homeDir(), 'config.json');
}

export function ensureHome(): void {
  for (const dir of ['', 'bots', 'skills', 'memory', 'workflows', 'workspace', 'logs']) {
    fs.mkdirSync(path.join(homeDir(), dir), { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureHome();
  const file = configPath();
  if (!fs.existsSync(file)) {
    const fresh = defaultConfig();
    saveConfig(fresh);
    return fresh;
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Config>;
  return { ...defaultConfig(), ...parsed, server: { ...defaultConfig().server, ...(parsed.server ?? {}) } };
}

export function saveConfig(config: Config): void {
  ensureHome();
  const file = configPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Copy of the config safe to send to UIs: secrets are masked. */
export function redactConfig(config: Config): Config {
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, p] of Object.entries(config.providers)) providers[id] = { ...p, apiKey: p.apiKey ? mask(p.apiKey) : undefined };
  return {
    ...config,
    token: mask(config.token),
    providers,
    telegram: config.telegram ? { ...config.telegram, token: mask(config.telegram.token) } : undefined,
    discord: config.discord ? { ...config.discord, token: mask(config.discord.token) } : undefined,
    devices: config.devices.map(d => ({ ...d, expoPushToken: mask(d.expoPushToken) })),
  };
}

export function mask(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function isMasked(value: string | undefined): boolean {
  return value === undefined || value === '••••' || /^.{4}….{4}$/.test(value);
}
