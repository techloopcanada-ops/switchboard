import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCommands } from '../src/commands.ts';

test('command picker filters known commands without swallowing paths or arguments', () => {
  assert.equal(filterCommands('/').length, 8);
  assert.deepEqual(filterCommands('/BO').map(command => command.id), ['bots', 'bot']);
  for (const text of ['/etc/hosts', '/unknown', 'ordinary text', '/learn useful hint', '/help\ntext']) assert.deepEqual(filterCommands(text), []);
});
test('bot and workflow suggestions keep the exact command for submission', () => {
  assert.equal(filterCommands('/bot cod', [{ id: 'coder', name: 'Coder' }, { id: 'guide', name: 'Guide' }])[0].insert, '/bot coder');
  assert.equal(filterCommands('/bot ', [{ id: 'coder', name: 'Coder' }]).length, 1);
  const workflow = { id: 'briefing', label: '/briefing', description: 'Morning briefing', insert: '/briefing' };
  assert.deepEqual(filterCommands('/br', [], [workflow]), [workflow]);
  assert.equal(filterCommands('/help', [], [{ ...workflow, id: 'help' }]).length, 1);
});
