import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';
/** 액션 인벤토리: list/get/create/update/delete/reply-list/reply-get/reply-create/reply-update/reply-delete. */
export function registerCommentCommand(program) {
    const root = program
        .command('comment')
        .description('Manage plan, finding, and task comments with 1-depth replies')
        .addHelpText('after', CONVENTION_HINT);
    const addLeaf = (name, description, configure = (command) => command) => {
        const command = addOutputOptions(configure(root.command(name).description(description))).addHelpText('after', CONVENTION_HINT);
        command.action(async (options) => {
            try {
                const { outputFile, verbose, ...actionOptions } = options;
                const result = await executeCommand('comment', name, actionOptions);
                printCommandResult({ result, outputFile, verbose });
            }
            catch (error) {
                console.error(handleError(error));
                process.exit(1);
            }
        });
        return command;
    };
    const addTargetOptions = (command) => command
        .option('--plan-id <id>', 'Plan ID')
        .option('--finding-id <id>', 'Code review finding ID')
        .option('--task-id <id>', 'Plan task ID');
    const addWriteOptions = (command) => command
        .option('--guide-hash <hash>', 'Hash of the comment guide you followed')
        .option('--idempotency-key <key>', 'Retry-safe key');
    const addMutationOptions = (command) => addWriteOptions(command).option('--expected-updated-at <iso>', "The comment's updatedAt as you last read it");
    addLeaf('list', 'List comments', (command) => addPaginationOptions(addTargetOptions(command)).option('--type <type>', 'Comment type (RISK, MODIFICATION, GENERAL)'));
    addLeaf('get', 'Get a comment', (command) => command.option('--id <id>', 'Comment ID'));
    addLeaf('create', 'Create a comment', (command) => addWriteOptions(addTargetOptions(command))
        .option('--type <type>', 'Comment type (RISK, MODIFICATION, GENERAL)')
        .option('--content <content>', 'Comment content')
        .option('--affected-files <files>', 'Comma-separated affected file paths'));
    addLeaf('update', 'Update a comment', (command) => addMutationOptions(command)
        .option('--id <id>', 'Comment ID')
        .option('--content <content>', 'Comment content')
        .option('--affected-files <files>', 'Comma-separated affected file paths'));
    addLeaf('delete', 'Delete a comment', (command) => addMutationOptions(command).option('--id <id>', 'Comment ID'));
    addLeaf('reply-list', 'List replies', (command) => addPaginationOptions(command.option('--id <id>', 'Parent comment ID')));
    addLeaf('reply-get', 'Get a reply', (command) => command.option('--reply-id <id>', 'Reply ID'));
    addLeaf('reply-create', 'Create a reply', (command) => addWriteOptions(command).option('--id <id>', 'Parent comment ID').option('--content <content>', 'Reply content'));
    addLeaf('reply-update', 'Update a reply', (command) => addMutationOptions(command).option('--reply-id <id>', 'Reply ID').option('--content <content>', 'Reply content'));
    addLeaf('reply-delete', 'Delete a reply', (command) => addMutationOptions(command).option('--reply-id <id>', 'Reply ID'));
}
//# sourceMappingURL=comment.js.map