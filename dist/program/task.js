import { CONVENTION_HINT } from './shared.js';
import { addGitToggleOption } from './options/completionReport.js';
import { addJsonResourceLeaf } from './options/resource.js';
import { RUNNER_TYPE_OPTION_DESCRIPTION } from '../utils/runnerTypes.js';
export function registerTaskCommand(program) {
    const root = program.command('task').description('Manage plan tasks').addHelpText('after', CONVENTION_HINT);
    const addLeaf = (action, description, configure) => addJsonResourceLeaf(root, 'task', action, description, configure, { connection: false });
    addLeaf('get', 'Get a plan task', (command) => command.option('--plan-id <id>', 'Plan ID (optional for bare task focus)').option('--task-id <id>', 'Plan task ID'));
    addLeaf('start', 'Start a plan task', (command) => command.option('--plan-id <id>', 'Plan ID').option('--task-id <id>', 'Plan task ID'));
    addLeaf('finish', 'Finish a plan task and optionally attach a task completion report', (command) => addGitToggleOption(command
        .option('--plan-id <id>', 'Plan ID')
        .option('--task-id <id>', 'Plan task ID')
        .option('--status <status>', 'Task finish status: DONE, BLOCKED, or SKIPPED')
        .option('--report-file <path>', 'Attach a task completion report read from a local file')
        .option('--report-title <title>', 'Task report title (default: "Task {N}. {task title}")')
        .option('--report-status <status>', 'Task report status: COMPLETED, FAILED, PARTIAL (default: from --status; BLOCKED → PARTIAL)')
        .option('--quality-score <n>', 'Quality score 0-100')
        .option('--review-recommendation <value>', 'Code review recommendation: REQUIRED or NOT_NEEDED')
        .option('--review-reason <text>', 'One-line reason for the review recommendation')
        .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
        .option('--model <model>', 'Model ID snapshot')
        .option('--fast', 'Request fast mode for the selected model when supported', false)
        .option('--keep-temp', 'Keep the uploaded file under .agentteams/cli/temp/ instead of deleting it after upload', false)
        .option('--commit-start <hash>', 'Commit the task started from; line and file counts are collected only with it')));
}
//# sourceMappingURL=task.js.map