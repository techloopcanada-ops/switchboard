import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.ts';

const MAX_MEMORY_CHARS = 12_000;

function memoryDir(): string {
  return path.join(homeDir(), 'memory');
}

export function botMemoryPath(botId: string): string {
  return path.join(memoryDir(), `${botId}.MEMORY.md`);
}

export function userProfilePath(): string {
  return path.join(memoryDir(), 'USER.md');
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function readBotMemory(botId: string): string {
  return readText(botMemoryPath(botId));
}

export function readUserProfile(): string {
  return readText(userProfilePath());
}

export function writeBotMemory(botId: string, text: string): void {
  fs.mkdirSync(memoryDir(), { recursive: true });
  fs.writeFileSync(botMemoryPath(botId), text.slice(0, MAX_MEMORY_CHARS));
}

export function writeUserProfile(text: string): void {
  fs.mkdirSync(memoryDir(), { recursive: true });
  fs.writeFileSync(userProfilePath(), text.slice(0, MAX_MEMORY_CHARS));
}

/** Append one dated bullet. Memory is bounded: oldest lines drop when the cap is reached. */
export function appendMemory(target: { botId: string } | { user: true }, note: string): string {
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${note.replace(/\s+/g, ' ').trim()}`;
  const current = 'user' in target ? readUserProfile() : readBotMemory(target.botId);
  let next = current ? `${current.trimEnd()}\n${line}\n` : `${line}\n`;
  while (next.length > MAX_MEMORY_CHARS) {
    const cut = next.indexOf('\n');
    if (cut === -1) break;
    next = next.slice(cut + 1);
  }
  if ('user' in target) writeUserProfile(next);
  else writeBotMemory(target.botId, next);
  return line;
}

export function memoryPromptSection(botId: string, enabled: boolean): string {
  if (!enabled) return '';
  const user = readUserProfile().trim();
  const bot = readBotMemory(botId).trim();
  const parts: string[] = [];
  if (user) parts.push(`## About the user (USER.md)\n${user}`);
  if (bot) parts.push(`## Your memory (MEMORY.md)\n${bot}`);
  if (!parts.length) return '';
  return `${parts.join('\n\n')}\n\nUse the remember tool to save durable facts, preferences and lessons. Keep notes short.`;
}
