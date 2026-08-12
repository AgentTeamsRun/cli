import { Command, CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerAgentConfigCommand(program: Command): void {
  const root = program
    .command('agent-config')
    .description('Manage agent configurations')
    .addHelpText('after', CONVENTION_HINT);
  addJsonResourceLeaf(root, 'agent-config', 'list', 'List agent configurations', undefined, {
    connection: false,
  });
  addJsonResourceLeaf(
    root,
    'agent-config',
    'get',
    'Get an agent configuration',
    (command) => command.option('--id <id>', 'Agent config ID'),
    { connection: false },
  );
  addJsonResourceLeaf(
    root,
    'agent-config',
    'delete',
    'Delete an agent configuration',
    (command) => command.option('--id <id>', 'Agent config ID'),
    { connection: false },
  );
}
