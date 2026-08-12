import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addConnectionOptions } from './options/connection.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';

/**
 * 액션 인벤토리: list/get/create/update/delete/download/cleanup/takeaway-list/takeaway-create/takeaway-update/takeaway-delete/history/link-plan/unlink-plan/link-completion-report/unlink-completion-report/link-post-mortem/unlink-post-mortem.
 * 각 leaf는 handler가 읽는 옵션만 선언하며 --limit 별칭은 제거합니다.
 */
export function registerCoactionCommand(program: Command): void {
  const parent = program
    .command('coaction')
    .description('Manage co-actions (session context dumps)')
    .addHelpText('after', CONVENTION_HINT);

  const addLeaf = (
    name: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ): Command => {
    const command = addOutputOptions(
      addConnectionOptions(configure(parent.command(name).description(description))),
    ).addHelpText('after', CONVENTION_HINT);

    command.action(async (options) => {
      try {
        const { outputFile, verbose, ...actionOptions } = options;
        const result = await executeCommand('coaction', name, actionOptions);

        printCommandResult({
          result,
          outputFile,
          verbose,
          resource: 'coaction',
          action: name,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });

    return command;
  };

  addLeaf('list', 'List co-actions', (command) =>
    addPaginationOptions(command)
      .option('--status <status>', 'Co-action status (OPEN, CLOSED)')
      .option('--visibility <visibility>', 'Co-action visibility (PRIVATE, PROJECT)')
      .option('--source <source>', 'Filter by source (MANUAL, AUTO_SESSION, ALL; default MANUAL)')
      .option('--search <text>', 'Title keyword search'),
  );
  addLeaf('get', 'Get a co-action', (command) => command.option('--id <id>', 'Co-action ID'));
  addLeaf('takeaway-list', 'List co-action takeaways', (command) =>
    addPaginationOptions(command).option('--id <id>', 'Co-action ID'),
  );
  addLeaf('takeaway-create', 'Create a co-action takeaway', (command) =>
    command
      .option('--id <id>', 'Co-action ID')
      .option('--content <content>', 'Takeaway content')
      .option('--file <path>', 'Read takeaway content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      ),
  );
  addLeaf('takeaway-update', 'Update a co-action takeaway', (command) =>
    command
      .option('--id <id>', 'Co-action ID')
      .option('--takeaway-id <id>', 'Co-action takeaway ID')
      .option('--content <content>', 'Takeaway content')
      .option('--file <path>', 'Read takeaway content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      ),
  );
  addLeaf('takeaway-delete', 'Delete a co-action takeaway', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--takeaway-id <id>', 'Co-action takeaway ID'),
  );
  addLeaf('history', 'List co-action history', (command) =>
    addPaginationOptions(command).option('--id <id>', 'Co-action ID'),
  );
  addLeaf('create', 'Create a co-action', (command) =>
    command
      .option('--title <title>', 'Co-action title')
      .option('--content <content>', 'Co-action content (short text; use --file for long content)')
      .option('--file <path>', 'Read co-action content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      )
      .option('--status <status>', 'Co-action status (OPEN, CLOSED)')
      .option('--visibility <visibility>', 'Co-action visibility (PRIVATE, PROJECT)'),
  );
  addLeaf('update', 'Update a co-action', (command) =>
    command
      .option('--id <id>', 'Co-action ID')
      .option('--title <title>', 'Co-action title')
      .option('--content <content>', 'Co-action content (short text; use --file for long content)')
      .option('--file <path>', 'Read co-action content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      )
      .option('--status <status>', 'Co-action status (OPEN, CLOSED)')
      .option('--visibility <visibility>', 'Co-action visibility (PRIVATE, PROJECT)')
      .option('--plan-id <id>', 'Plan ID to set, or null to clear'),
  );
  addLeaf('delete', 'Delete a co-action', (command) => command.option('--id <id>', 'Co-action ID'));
  addLeaf('download', 'Download a co-action', (command) => command.option('--id <id>', 'Co-action ID'));
  addLeaf('cleanup', 'Remove downloaded co-actions', (command) =>
    command.option('--id <id>', 'Co-action ID (omit to remove all downloaded co-actions)'),
  );
  addLeaf('link-plan', 'Link a plan', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--plan-id <id>', 'Plan ID'),
  );
  addLeaf('unlink-plan', 'Unlink a plan', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--plan-id <id>', 'Plan ID'),
  );
  addLeaf('link-completion-report', 'Link a completion report', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--completion-report-id <id>', 'Completion report ID'),
  );
  addLeaf('unlink-completion-report', 'Unlink a completion report', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--completion-report-id <id>', 'Completion report ID'),
  );
  addLeaf('link-post-mortem', 'Link a post-mortem', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--post-mortem-id <id>', 'Post-mortem ID'),
  );
  addLeaf('unlink-post-mortem', 'Unlink a post-mortem', (command) =>
    command.option('--id <id>', 'Co-action ID').option('--post-mortem-id <id>', 'Post-mortem ID'),
  );
}
