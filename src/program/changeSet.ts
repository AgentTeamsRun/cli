import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addConnectionOptions } from './options/connection.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';

/** 액션 인벤토리: create/list/get/update/delete/add-item/remove-item. */
export function registerChangeSetCommand(program: Command): void {
  const root = program
    .command('change-set')
    .description('Manage cross-repository change sets and merge order')
    .addHelpText('after', CONVENTION_HINT);
  const addLeaf = (
    name: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ): Command => {
    const command = addOutputOptions(
      addConnectionOptions(configure(root.command(name).description(description))),
    ).addHelpText('after', CONVENTION_HINT);
    command.action(async (options) => {
      try {
        const { outputFile, verbose, ...actionOptions } = options;
        const result = await executeCommand('change-set', name, actionOptions);
        printCommandResult({
          result,
          outputFile,
          verbose,
          resource: 'change-set',
          action: name,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
    return command;
  };
  const addMetadata = (command: Command) =>
    command
      .option('--title <title>', 'Change set title')
      .option('--description <text>', 'Change set description')
      .option('--status <status>', 'Status (OPEN, COMPLETED, CANCELLED)');
  addLeaf('create', 'Create a change set', addMetadata);
  addLeaf('list', 'List change sets', addPaginationOptions);
  addLeaf('get', 'Get a change set', (command) => command.option('--id <id>', 'Change set ID'));
  addLeaf('update', 'Update a change set', (command) => addMetadata(command.option('--id <id>', 'Change set ID')));
  addLeaf('delete', 'Delete a change set', (command) => command.option('--id <id>', 'Change set ID'));
  addLeaf('add-item', 'Add a change set item', (command) =>
    command
      .option('--change-set-id <id>', 'Change set ID')
      .option('--repository-id <id>', 'Project repository ID')
      .option('--repository-remote-url <url>', 'Repository remote URL (defaults to git origin)')
      .option('--no-git', 'Disable automatic git origin detection')
      .option('--branch-name <name>', 'Branch name')
      .option('--target-url <url>', 'Pull or merge request URL')
      .option('--merge-order <number>', 'Merge order')
      .option('--code-review-id <id>', 'Linked code review ID')
      .option('--note <text>', 'Item note'),
  );
  addLeaf('remove-item', 'Remove a change set item', (command) =>
    command.option('--change-set-id <id>', 'Change set ID').option('--item-id <id>', 'Change set item ID'),
  );
}
