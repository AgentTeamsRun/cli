import type { Command } from 'commander';

export function addPaginationOptions(command: Command): Command {
  return command
    .option('--page <number>', 'Page number (list only)')
    .option('--page-size <number>', 'Page size (list only)');
}
