import { Command, CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerFeedbackCommand(program: Command): void {
  const root = program.command('feedback').description('Send product feedback').addHelpText('after', CONVENTION_HINT);
  addJsonResourceLeaf(root, 'feedback', 'create', 'Create feedback', (command) =>
    command
      .option('--category <category>', 'Feedback category (BUG, SUGGESTION, CONVENTION, UX)')
      .option('--title <title>', 'Feedback title')
      .option('--content <content>', 'Feedback content'),
  );
}
