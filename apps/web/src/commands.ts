export interface CommandOption { id: string; label: string; description: string; insert: string }
export const COMMANDS: CommandOption[] = [
  { id: 'help', label: '/help', description: 'Show commands', insert: '/help' },
  { id: 'bots', label: '/bots', description: 'List your bots', insert: '/bots' },
  { id: 'bot', label: '/bot <id>', description: 'Start a chat with another bot', insert: '/bot ' },
  { id: 'new', label: '/new', description: 'Start a new conversation', insert: '/new' },
  { id: 'skills', label: '/skills', description: 'List installed skills', insert: '/skills' },
  { id: 'learn', label: '/learn [hint]', description: 'Suggest a skill from this chat', insert: '/learn' },
  { id: 'usage', label: '/usage', description: 'Show monthly usage', insert: '/usage' },
  { id: 'status', label: '/status', description: 'Show this installation’s capabilities', insert: '/status' },
];
export function filterCommands(text: string, bots: { id: string; name: string }[] = [], workflows: CommandOption[] = []): CommandOption[] {
  const bot = /^\/bot\s+([^\s]*)$/i.exec(text);
  if (bot) return bots.filter(item => `${item.id} ${item.name}`.toLowerCase().includes(bot[1].toLowerCase())).map(item => ({ id: `bot:${item.id}`, label: `/bot ${item.id}`, description: item.name, insert: `/bot ${item.id}` }));
  if (!/^\/[a-z0-9_-]*$/i.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return [...COMMANDS, ...workflows.filter(item => !COMMANDS.some(command => command.id === item.id))].filter(item => item.id.toLowerCase().startsWith(query));
}
