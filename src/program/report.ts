import { Command, CONVENTION_HINT } from './shared.js';
import {
  addCompletionReportMetricsOptions,
  addCompletionReportMetricValueOptions,
} from './options/completionReport.js';
import { addPaginationOptions } from './options/pagination.js';
import { addJsonResourceLeaf } from './options/resource.js';
import { RUNNER_TYPE_OPTION_DESCRIPTION } from '../utils/runnerTypes.js';

/** 액션 인벤토리: list/get/create/update/dismiss-review/delete/download. */
export function registerReportCommand(program: Command): void {
  const root = program.command('report').description('Manage completion reports').addHelpText('after', CONVENTION_HINT);
  const addLeaf = (
    action: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ) => addJsonResourceLeaf(root, 'report', action, description, configure);
  addLeaf('list', 'List completion reports', (command) =>
    addPaginationOptions(command)
      .option('--plan-id <id>', 'Plan ID')
      .option('--status <status>', 'Report status')
      .option('--search <text>', 'Title keyword search'),
  );
  addLeaf('get', 'Get a completion report', (command) => command.option('--id <id>', 'Report ID'));
  addLeaf('create', 'Create a completion report', (command) =>
    addCompletionReportMetricsOptions(command)
      .option('--plan-id <id>', 'Plan ID')
      .option('--title <title>', 'Report title')
      .option('--file <path>', 'Read report content from a local file')
      .option('--keep-temp', 'Keep the uploaded temporary file', false)
      .option('--status <status>', 'Report status (COMPLETED, FAILED, PARTIAL)')
      .option('--quality-score <n>', 'Quality score 0-100')
      .option('--review-recommendation <value>', 'Code review recommendation: REQUIRED or NOT_NEEDED')
      .option('--review-reason <text>', 'One-line reason for the review recommendation')
      .option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)')
      .option('--runner-type <type>', RUNNER_TYPE_OPTION_DESCRIPTION)
      .option('--model <model>', 'Model ID snapshot'),
  );
  addLeaf('update', 'Update a completion report', (command) =>
    addCompletionReportMetricValueOptions(command)
      .option('--id <id>', 'Report ID')
      .option('--title <title>', 'Report title')
      .option('--file <path>', 'Read report content from a local file')
      .option('--status <status>', 'Report status (COMPLETED, FAILED, PARTIAL)')
      .option('--quality-score <n>', 'Quality score 0-100')
      .option('--review-recommendation <value>', 'Compatibility notice only')
      .option('--review-reason <text>', 'Compatibility notice only'),
  );
  addLeaf('dismiss-review', 'Dismiss a report review recommendation', (command) =>
    command.option('--id <id>', 'Report ID'),
  );
  addLeaf('delete', 'Delete a completion report', (command) => command.option('--id <id>', 'Report ID'));
  addLeaf('download', 'Download a completion report', (command) => command.option('--id <id>', 'Report ID'));
}
