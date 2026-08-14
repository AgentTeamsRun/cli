import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addGitToggleOption } from './options/completionReport.js';
import { addConnectionOptions } from './options/connection.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';
import { RUNNER_TYPE_OPTION_DESCRIPTION } from '../utils/runnerTypes.js';

/** 액션 인벤토리: list/get/create/update/create-plan/submit-result/cancel/delete/dismiss/resolve/undismiss. */
export function registerCodeReviewCommand(program: Command): void {
  const root = program
    .command('code-review')
    .description('Manage independent code reviews')
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
        const result = await executeCommand('code-review', name, actionOptions);
        printCommandResult({
          result,
          outputFile,
          verbose,
          resource: 'code-review',
          action: name,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
    return command;
  };

  addLeaf('list', 'List code reviews', (command) =>
    addPaginationOptions(command)
      .option('--search <text>', 'Search keyword')
      .option('--status <status>', 'Status filter')
      .option('--target-type <type>', 'Review target type')
      .option('--source-plan-id <id>', 'Source plan ID')
      .option('--source-completion-report-id <id>', 'Source completion report ID'),
  );
  addLeaf('get', 'Get a code review or finding', (command) =>
    command.option('--id <id>', 'Code review ID').option('--finding-id <id>', 'Finding ID for single-finding focus'),
  );
  addLeaf('create', 'Create a code review', (command) =>
    addGitToggleOption(command)
      .option('--title <title>', 'Code review title')
      .option('--target-type <type>', 'Review target type')
      .option('--target-ref <ref>', 'Target reference')
      .option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)')
      .option('--source-plan-id <id>', 'Source plan ID')
      .option('--source-completion-report-id <id>', 'Source completion report ID')
      .option('--source-commit-start <hash>', 'Source commit range start')
      .option('--source-commit-end <hash>', 'Source commit range end')
      .option('--source-branch-name <name>', 'Source branch name')
      .option('--base-branch-name <name>', 'Base branch name')
      .option('--diff-summary <text>', 'Diff summary text')
      .option('--diff-file <path>', 'Read diff summary from a local file')
      .option('--test-summary <text>', 'Verification summary text')
      .option('--test-file <path>', 'Read verification summary from a local file')
      .option('--reviewer-context <text>', 'Reviewer context or instructions')
      .option('--recommendation-reason <text>', 'Why this review is recommended')
      .option('--findings-file <path>', 'Read findings JSON array from a local file')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot'),
  );
  addLeaf('update', 'Update a code review', (command) =>
    command
      .option('--id <id>', 'Code review ID')
      .option('--title <title>', 'Code review title')
      .option('--target-type <type>', 'Review target type')
      .option('--target-ref <ref>', 'Target reference')
      .option('--source-commit-start <hash>', 'Source commit range start')
      .option('--source-commit-end <hash>', 'Source commit range end')
      .option('--source-branch-name <name>', 'Source branch name')
      .option('--base-branch-name <name>', 'Base branch name')
      .option('--diff-summary <text>', 'Diff summary text')
      .option('--diff-file <path>', 'Read diff summary from a local file')
      .option('--test-summary <text>', 'Verification summary text')
      .option('--test-file <path>', 'Read verification summary from a local file')
      .option('--reviewer-context <text>', 'Reviewer context or instructions')
      .option('--recommendation-reason <text>', 'Why this review is recommended')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot'),
  );
  addLeaf('create-plan', 'Create a plan from findings', (command) =>
    command
      .option('--id <id>', 'Code review ID')
      .option('--title <title>', 'Generated plan title')
      .option('--finding-ids <ids>', 'Comma-separated finding IDs')
      .option('--priority <priority>', 'Generated plan priority')
      .option('--type <type>', 'Generated plan type')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot'),
  );
  addLeaf('submit-result', 'Submit a code review result', (command) =>
    command
      .option('--id <id>', 'Code review ID')
      .option('--status <status>', 'Result status COMPLETED|FAILED')
      .option('--findings-file <path>', 'Read findings JSON array from a local file')
      .option('--result-summary <text>', 'Review result summary')
      .option('--error-message <text>', 'Failure reason when status is FAILED'),
  );
  addLeaf('cancel', 'Cancel a code review', (command) => command.option('--id <id>', 'Code review ID'));
  addLeaf('delete', 'Delete a code review', (command) => command.option('--id <id>', 'Code review ID'));
  addLeaf('dismiss', 'Dismiss a finding', (command) =>
    command.option('--id <id>', 'Code review ID').option('--finding-id <id>', 'Finding ID'),
  );
  addLeaf('resolve', 'Resolve findings', (command) =>
    command
      .option('--id <id>', 'Code review ID')
      .option('--finding-id <id>', 'Finding ID')
      .option('--finding-ids <ids>', 'Comma-separated finding IDs'),
  );
  addLeaf('undismiss', 'Restore a dismissed finding', (command) =>
    command.option('--id <id>', 'Code review ID').option('--finding-id <id>', 'Finding ID'),
  );
}
