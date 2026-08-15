import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';

/** 액션 인벤토리: list/show/download/status/create/update/delete. */
export function registerSkillCommand(program: Command): void {
  const root = program
    .command('skill')
    .description('Manage project skill packages')
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
        const result = await executeCommand('skill', name, {
          ...actionOptions,
          cwd: actionOptions.cwd ?? process.cwd(),
        });
        printCommandResult({ result, resource: 'skill', action: name, outputFile, verbose });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
    return command;
  };

  const addCwd = (command: Command) => command.option('--cwd <path>', 'Working directory (defaults to current)');
  const addPackageSource = (command: Command) =>
    addCwd(command)
      .option('--dir <path>', 'Skill package directory (contains SKILL.md)')
      .option('-f, --file <path>', 'Path to SKILL.md (its parent directory is the package root)')
      .option('--apply', 'Apply the change on the server (default: dry-run)', false);

  addLeaf('list', 'List project skills', (command) =>
    addCwd(command)
      .option('--search <keyword>', 'Filter by keyword')
      .option('--page <number>', 'Page number')
      .option('--page-size <number>', 'Page size'),
  );

  addLeaf('show', 'Show one skill', (command) => addCwd(command).option('--id <id>', 'Skill ID'));

  addLeaf('download', 'Sync every skill package into .agentteams/skills/', (command) =>
    addCwd(command)
      .option(
        '--skill-targets <targets>',
        "Mirror targets: comma-separated list of agents,claude,github or 'none' (default: detected from marker directories)",
      )
      .option('--commit-mirrors', 'Do not add mirror directories to .gitignore', false),
  );

  addLeaf('status', 'Show which skill packages are new, updated, or deleted', (command) => addCwd(command));

  addLeaf('create', 'Create a skill from a local package directory', (command) =>
    addPackageSource(command)
      .option('--slug <slug>', 'Package slug (defaults to the directory name)')
      .option('--repository-id <id>', 'Link the skill to a repository')
      .option('--scope <scope>', 'PROJECT or PERSONAL'),
  );

  addLeaf('update', 'Replace a skill package from a local directory', (command) =>
    addPackageSource(command).option('--id <id>', 'Skill ID').option('--scope <scope>', 'PROJECT or PERSONAL'),
  );

  addLeaf('delete', 'Delete a skill', (command) =>
    addCwd(command).option('--id <id>', 'Skill ID').option('--apply', 'Apply the deletion on the server', false),
  );
}
