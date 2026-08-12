import { Command, CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerTaskCommand(program: Command): void {
  const root = program.command('task').description('Manage plan tasks').addHelpText('after', CONVENTION_HINT);
  const addLeaf = (action: string, description: string, configure: (command: Command) => Command) =>
    addJsonResourceLeaf(root, 'task', action, description, configure, { connection: false });
  addLeaf('get', 'Get a plan task', (command) =>
    command.option('--plan-id <id>', 'Plan ID (optional for bare task focus)').option('--task-id <id>', 'Plan task ID'),
  );
  addLeaf('start', 'Start a plan task', (command) =>
    command.option('--plan-id <id>', 'Plan ID').option('--task-id <id>', 'Plan task ID'),
  );
  addLeaf('finish', 'Finish a plan task', (command) =>
    command
      .option('--plan-id <id>', 'Plan ID')
      .option('--task-id <id>', 'Plan task ID')
      .option('--status <status>', 'Task finish status: DONE, BLOCKED, or SKIPPED'),
  );
}
