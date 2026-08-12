import { Command, CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerConfigCommand(program: Command): void {
  const root = program.command('config').description('Inspect CLI configuration').addHelpText('after', CONVENTION_HINT);
  addJsonResourceLeaf(root, 'config', 'whoami', 'Show the current API identity', undefined, {
    connection: false,
  });
}
