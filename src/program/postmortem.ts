import { Command, CONVENTION_HINT } from './shared.js';
import { addGitToggleOption } from './options/completionReport.js';
import { addPaginationOptions } from './options/pagination.js';
import { addJsonResourceLeaf } from './options/resource.js';

/** 액션 인벤토리: list/get/create/update/delete/download. */
export function registerPostmortemCommand(program: Command): void {
  const root = program.command('postmortem').description('Manage post mortems').addHelpText('after', CONVENTION_HINT);
  const addLeaf = (
    action: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ) => addJsonResourceLeaf(root, 'postmortem', action, description, configure);
  const addContent = (command: Command) =>
    command
      .option('--plan-id <id>', 'Plan ID')
      .option('--title <title>', 'Post mortem title')
      .option('--content <content>', 'Post mortem markdown content')
      .option('--file <path>', 'Read postmortem content from a local file')
      .option('--keep-temp', 'Keep the uploaded temporary file', false)
      .option('--action-items <csv>', 'Action items (comma-separated)')
      .option('--status <status>', 'Post mortem status');
  addLeaf('list', 'List post mortems', (command) =>
    addPaginationOptions(command)
      .option('--plan-id <id>', 'Plan ID')
      .option('--status <status>', 'Post mortem status')
      .option('--search <text>', 'Title keyword search'),
  );
  addLeaf('get', 'Get a post mortem', (command) => command.option('--id <id>', 'Post mortem ID'));
  addLeaf('create', 'Create a post mortem', (command) =>
    addGitToggleOption(addContent(command)).option(
      '--repository-remote-url <url>',
      'Repository remote origin URL (defaults to git origin)',
    ),
  );
  addLeaf('update', 'Update a post mortem', (command) => addContent(command.option('--id <id>', 'Post mortem ID')));
  addLeaf('delete', 'Delete a post mortem', (command) => command.option('--id <id>', 'Post mortem ID'));
  addLeaf('download', 'Download a post mortem', (command) => command.option('--id <id>', 'Post mortem ID'));
}
