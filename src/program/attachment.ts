import { Command, CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerAttachmentCommand(program: Command): void {
  const root = program
    .command('attachment')
    .description('Manage trigger, document, and evidence attachments')
    .addHelpText('after', CONVENTION_HINT);
  addJsonResourceLeaf(root, 'attachment', 'list', 'List attachments', (command) =>
    command.option('--trigger-id <id>', 'Daemon trigger ID').option('--document-id <id>', 'Document ID'),
  );
  addJsonResourceLeaf(root, 'attachment', 'create', 'Create an attachment', (command) =>
    command
      .option('--document-id <id>', 'Document ID')
      .option('--file <path>', 'Local file to upload')
      .option('--code-review-id <id>', 'Attach to this code review')
      .option('--completion-report-id <id>', 'Attach to this completion report'),
  );
  addJsonResourceLeaf(root, 'attachment', 'upload', 'Explain the supported attachment upload command');
  addJsonResourceLeaf(root, 'attachment', 'delete', 'Explain attachment deletion support');
}
