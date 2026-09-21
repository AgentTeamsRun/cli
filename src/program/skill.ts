import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';

/** 액션 인벤토리: list/show/download/status/create/update/delete + share/unshare/shares/browse/install. */
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

  addLeaf('download', 'Sync skill packages into .agentteams/skills/ while preserving local changes', (command) =>
    addCwd(command)
      .option(
        '--release-lock',
        'Release an abandoned lock without downloading; check recovery directories first',
        false,
      )
      .option('--id <id>', 'Sync only this skill (including its previous paths and mirrors)')
      .option('--force', 'Replace local changes for --id or --all', false)
      .option('--all', 'With --force, replace all skill packages and remove server-deleted packages', false)
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

  const addPaging = (command: Command) =>
    command.option('--page <number>', 'Page number').option('--page-size <number>', 'Page size');

  addLeaf('share', 'Publish a skill to everyone, a team, or a link (dry-run without --apply)', (command) =>
    addCwd(command)
      .option('--id <id>', 'Skill ID')
      .option('--scope <scope>', 'public, team, or link')
      .option('--include-body', 'Include SKILL.md and other text files (server default: on)')
      .option('--no-include-body', 'Expose metadata only, without file bodies')
      .option('--include-executable', 'Also expose scripts/ and assets/ (default: off)')
      .option('--no-allow-install', 'Forbid viewers from installing a copy')
      .option('--expires-at <iso8601>', 'Expiry timestamp, e.g. 2026-12-31T00:00:00Z')
      .option('--apply', 'Publish the share on the server (default: dry-run)', false),
  );

  addLeaf('unshare', 'Revoke a share (dry-run without --apply)', (command) =>
    addCwd(command)
      .option('--id <shareId>', 'Share ID')
      .option('--skill <skillId>', 'Skill ID that owns the share')
      .option('--apply', 'Revoke the share on the server (default: dry-run)', false),
  );

  addLeaf('shares', 'Show shares and install records of a skill', (command) =>
    addPaging(addCwd(command).option('--id <id>', 'Skill ID')),
  );

  addLeaf('browse', 'Browse skills shared with this project (public and its team shares)', (command) =>
    addPaging(addCwd(command).option('--search <keyword>', 'Filter by keyword')),
  );

  addLeaf('install', 'Copy a shared skill into this project (dry-run lists the files without --apply)', (command) =>
    addCwd(command)
      .option('--share <shareId>', 'Share ID from `skill browse` (public/team shares)')
      .option('--token <linkToken>', 'Link token or full share URL (link shares)')
      .option('--apply', 'Install on the server (default: dry-run)', false),
  );
}
