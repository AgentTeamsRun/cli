import { Command, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addCompletionReportMetricsOptions, addGitToggleOption } from './options/completionReport.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';
import { RUNNER_TYPE_OPTION_DESCRIPTION } from '../utils/runnerTypes.js';

/**
 * 액션 인벤토리: list/get/create/update/delete/download/cleanup/start/finish/quick/status/set-status/link-issue/unlink-issue/list-issues.
 * get/show와 link-issue/issue는 별칭이었으며 get과 link-issue만 유지합니다.
 */
export function registerPlanCommand(program: Command): void {
  const planCommand = program.command('plan').description('Manage plans').addHelpText('after', CONVENTION_HINT);

  const addLeaf = (
    name: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ): Command => {
    const command = addOutputOptions(configure(planCommand.command(name).description(description))).addHelpText(
      'after',
      CONVENTION_HINT,
    );

    command.action(async (options) => {
      try {
        const { outputFile, verbose, ...actionOptions } = options;
        const result = await executeCommand('plan', name, actionOptions);

        printCommandResult({
          result,
          outputFile,
          verbose,
          resource: 'plan',
          action: name,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });

    return command;
  };

  addLeaf('list', 'List plans', (command) =>
    addPaginationOptions(command)
      .option('--title <title>', 'Plan title')
      .option('--search <text>', 'Plan title/ID search keyword')
      .option('--status <status>', 'Plan status')
      .option('--type <type>', 'Plan type (FEATURE, BUG_FIX, ISSUE, REFACTOR, CHORE)')
      .option('--assigned-to <id>', 'Agent config ID or name'),
  );

  addLeaf('get', 'Get a plan', (command) =>
    command.option('--id <id>', 'Plan ID').option('--include-deps', 'Include dependencies in plan output', false),
  );

  addLeaf('status', 'Get plan lifecycle status', (command) => command.option('--id <id>', 'Plan ID'));

  addLeaf('set-status', 'Set plan lifecycle status', (command) =>
    command.option('--id <id>', 'Plan ID').option('--status <status>', 'Plan status'),
  );

  addLeaf('start', 'Start plan execution', (command) =>
    addGitToggleOption(command)
      .option('--id <id>', 'Plan ID')
      .option('--assigned-to <id>', 'Agent config ID or name')
      .option('--task <text>', 'Task summary')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot')
      .option('--fast', 'Request fast mode for the selected model when supported', false),
  );

  addLeaf('finish', 'Finish a plan and optionally attach a completion report', (command) =>
    addCompletionReportMetricsOptions(command)
      .option('--id <id>', 'Plan ID')
      .option('--task <text>', 'Task summary')
      .option('--report-title <title>', 'Completion report title')
      .option('--report-file <path>', 'Read completion report content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      )
      .option('--report-status <status>', 'Completion report status: COMPLETED, FAILED, PARTIAL')
      .option('--quality-score <n>', 'Quality score 0-100')
      .option('--review-recommendation <value>', 'Code review recommendation: REQUIRED or NOT_NEEDED')
      .option('--review-reason <text>', 'One-line reason for the review recommendation')
      .option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot')
      .option('--fast', 'Request fast mode for the selected model when supported', false),
  );

  addLeaf('create', 'Create a plan', (command) =>
    addGitToggleOption(command)
      .option('--title <title>', 'Plan title')
      .option('--content <content>', 'Plan content (plain text or Tiptap JSON)')
      .option('--interpret-escapes', 'Interpret \\n sequences in --content as newlines', false)
      .option('--file <path>', 'Read plan content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      )
      .option('--template <name>', 'Plan content template (refactor-minimal, quick-minimal)')
      .option('--status <status>', 'Ignored because new plans start as BACKLOG')
      .option('--type <type>', 'Plan type (FEATURE, BUG_FIX, ISSUE, REFACTOR, CHORE)')
      .option('--complexity <level>', 'Plan complexity (MINIMAL, STANDARD, FULL; required)')
      .option('--priority <priority>', 'Plan priority (LOW, MEDIUM, HIGH)')
      .option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot')
      .option('--fast', 'Request fast mode for the selected model when supported', false),
  );

  addLeaf('update', 'Update a plan', (command) =>
    command
      .option('--id <id>', 'Plan ID')
      .option('--title <title>', 'Plan title')
      .option('--content <content>', 'Plan content (plain text or Tiptap JSON)')
      .option('--interpret-escapes', 'Interpret \\n sequences in --content as newlines', false)
      .option('--file <path>', 'Read plan content from a local file')
      .option(
        '--keep-temp',
        'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload',
        false,
      )
      .option('--status <status>', 'Plan status')
      .option('--type <type>', 'Plan type (FEATURE, BUG_FIX, ISSUE, REFACTOR, CHORE)')
      .option('--complexity <level>', 'Plan complexity (MINIMAL, STANDARD, FULL)')
      .option('--complexity-reason <text>', 'Reason for changing complexity (recorded as a MODIFICATION comment)')
      .option('--priority <priority>', 'Plan priority (LOW, MEDIUM, HIGH)'),
  );

  addLeaf('delete', 'Delete a plan', (command) => command.option('--id <id>', 'Plan ID'));
  addLeaf('download', 'Download a plan runbook', (command) => command.option('--id <id>', 'Plan ID'));
  addLeaf('cleanup', 'Remove downloaded plan runbooks', (command) =>
    command.option('--id <id>', 'Plan ID (omit to remove all downloaded plans)'),
  );

  addLeaf('quick', 'Create and finish a quick log', (command) =>
    addCompletionReportMetricsOptions(command)
      .option('--title <title>', 'Plan title')
      .option('--content <content>', 'Plan content')
      .option('--interpret-escapes', 'Interpret \\n sequences in --content as newlines', false)
      .option('--file <path>', 'Read plan content from a local file')
      .option(
        '--keep-temp',
        'Keep uploaded files under .agentteams/cli/temp/ instead of deleting them after upload',
        false,
      )
      .option('--type <type>', 'Plan type (FEATURE, BUG_FIX, ISSUE, REFACTOR, CHORE)')
      .option('--complexity <level>', 'Plan complexity (MINIMAL, STANDARD, FULL)')
      .option('--priority <priority>', 'Plan priority (LOW, MEDIUM, HIGH)')
      .option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)')
      .option('--assigned-to <id>', 'Agent config ID or name')
      .option('--report-title <title>', 'Completion report title')
      .option('--report-file <path>', 'Read completion report content from a local file')
      .option('--report-status <status>', 'Completion report status: COMPLETED, FAILED, PARTIAL')
      .option('--quality-score <n>', 'Quality score 0-100')
      .option('--review-recommendation <value>', 'Code review recommendation: REQUIRED or NOT_NEEDED')
      .option('--review-reason <text>', 'One-line reason for the review recommendation')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot')
      .option('--fast', 'Request fast mode for the selected model when supported', false),
  );

  // 러너(@agentteams/runner)는 CLI와 별도로 배포되므로, CLI만 먼저 올라간 환경의
  // 구 러너가 여전히 `plan issue`를 호출합니다. 한 릴리스 동안 숨은 별칭으로 흡수합니다.
  // (별칭이어도 command.name()은 'link-issue'라 액션 분기는 그대로입니다.)
  addLeaf('link-issue', 'Link an external issue to a plan', (command) =>
    command
      .alias('issue')
      .option('--id <id>', 'Plan ID')
      .option('--provider <provider>', 'External issue provider (GITHUB, GITLAB, LINEAR, SENTRY)')
      .option('--external-id <id>', 'External issue ID')
      .option('--external-url <url>', 'External issue URL (optional for SENTRY; verified by the server)')
      .option('--title <title>', 'External issue title')
      .option('--metadata <json>', 'Provider metadata as JSON (e.g. {"owner":"org","repo":"name"})'),
  );

  addLeaf('unlink-issue', 'Unlink an external issue from a plan', (command) =>
    command.option('--id <id>', 'Plan ID').option('--issue-id <id>', 'PlanExternalIssue ID'),
  );

  addLeaf('list-issues', 'List external issues linked to a plan', (command) => command.option('--id <id>', 'Plan ID'));
}
