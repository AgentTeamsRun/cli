import { Command, executeCommand, handleError, printCommandResult } from './shared.js';

export function registerWorktreeCommand(program: Command): void {
  const root = program.command('worktree').description('Report Orca worktree lifecycle events');
  const addLeaf = (action: string, description: string) => {
    const command = root
      .command(action)
      .description(description)
      .option('--repository-id <id>', 'AgentTeams repository ID (optional when remote origin matches)')
      .option('--local-key <key>', 'Opaque worktree identity')
      .option('--event-id <id>', 'Stable event ID for retries')
      .option('--occurred-at <timestamp>', 'Event timestamp in ISO 8601 format')
      .option('--quiet', 'Do not print a successful result', false);
    if (action === 'notify-deleted')
      command.option('--after-removal', 'Send only after the worktree path disappears', false);
    command.action(async (options) => {
      try {
        const result = await executeCommand('worktree', action, { ...options, cwd: process.cwd() });
        if (!options.quiet) printCommandResult({ result, resource: 'worktree', action });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
  };
  addLeaf('notify-created', 'Report a created worktree');
  addLeaf('notify-deleted', 'Report a deleted worktree');
}
