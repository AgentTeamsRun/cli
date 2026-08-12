import type { Command } from 'commander';

export function addGitToggleOption(command: Command): Command {
  return command.option('--no-git', 'Disable git metrics auto-collection');
}

export function addCompletionReportMetricsOptions(command: Command): Command {
  return addGitToggleOption(addCompletionReportMetricValueOptions(command));
}

export function addCompletionReportMetricValueOptions(command: Command): Command {
  return command
    .option('--commit-hash <hash>', 'Git commit hash (manual override)')
    .option('--branch-name <name>', 'Branch name (manual override)')
    .option('--files-modified <n>', 'Number of modified files (manual override)')
    .option('--lines-added <n>', 'Number of added lines (manual override)')
    .option('--lines-deleted <n>', 'Number of deleted lines (manual override)')
    .option('--duration-seconds <n>', 'Duration in seconds (manual only)')
    .option('--commit-start <hash>', 'Commit range start hash (manual only)')
    .option('--commit-end <hash>', 'Commit range end hash (manual only)')
    .option('--pull-request-id <id>', 'Pull request ID (manual only)');
}
