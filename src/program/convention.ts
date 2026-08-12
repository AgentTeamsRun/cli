import { Command, Option, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';

/** 액션 인벤토리: list/show/download/status/create/update/delete. */
export function registerConventionCommand(program: Command): void {
  const root = program
    .command('convention')
    .description('Manage project conventions')
    .addHelpText('after', CONVENTION_HINT);
  const addLeaf = (
    name: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ): Command => {
    const command = addOutputOptions(configure(root.command(name).description(description))).addHelpText(
      'after',
      CONVENTION_HINT,
    );
    command.action(async (options) => {
      try {
        const { outputFile, verbose, ...actionOptions } = options;
        const result = await executeCommand('convention', name, {
          ...actionOptions,
          cwd: actionOptions.cwd ?? process.cwd(),
        });
        printCommandResult({ result, outputFile, verbose });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
    return command;
  };
  const addCwd = (command: Command) => command.option('--cwd <path>', 'Working directory (defaults to current)');
  const addFiles = (command: Command) =>
    addCwd(command).option(
      '-f, --file <path>',
      'Target convention markdown file (repeatable)',
      (value, previous: string[] = []) => previous.concat([value]),
      [] as string[],
    );
  addLeaf('list', 'List project conventions');
  addLeaf('show', 'Show the effective convention');
  addLeaf('download', 'Download project conventions', addCwd);
  addLeaf('status', 'Show convention freshness status', addCwd);
  addLeaf('create', 'Create project conventions', (command) =>
    addFiles(command).addOption(
      new Option('--scope <scope>', 'Convention scope (defaults to PROJECT)').choices(['PROJECT', 'PERSONAL']),
    ),
  );
  addLeaf('update', 'Update project conventions', (command) =>
    addFiles(command).option('--apply', 'Apply changes to server (default: dry-run)', false),
  );
  addLeaf('delete', 'Delete project conventions', (command) =>
    addFiles(command).option('--apply', 'Apply changes to server (default: dry-run)', false),
  );
}
