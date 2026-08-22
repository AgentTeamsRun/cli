import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addConnectionOptions } from './options/connection.js';
import { addOutputOptions } from './options/output.js';
import { addPaginationOptions } from './options/pagination.js';
/**
 * 액션 인벤토리: create/update/download/list/tags/delete/archive/unarchive/revisions/revision-get/revision-restore/comment-list/comment-create/comment-update/comment-delete.
 * archive/unarchive는 반대 동작의 별개 액션이며 --limit 별칭은 제거합니다.
 */
export function registerDocumentCommand(program) {
    const parent = program
        .command('document')
        .description('Manage project documents')
        .addHelpText('after', CONVENTION_HINT);
    const addLeaf = (name, description, configure = (command) => command) => {
        const command = addOutputOptions(addConnectionOptions(configure(parent.command(name).description(description)))).addHelpText('after', CONVENTION_HINT);
        command.action(async (options) => {
            try {
                const { outputFile, verbose, ...actionOptions } = options;
                const result = await executeCommand('document', name, actionOptions);
                printCommandResult({
                    result,
                    outputFile,
                    verbose,
                    resource: 'document',
                    action: name,
                });
            }
            catch (error) {
                console.error(handleError(error));
                process.exit(1);
            }
        });
        return command;
    };
    const addWriteContractOptions = (command, includeExpectedUpdatedAt = false) => {
        const configured = command
            .option('--guide-hash <hash>', 'Hash of the document guide you followed. Stale hash is rejected with GUIDE_OUTDATED.')
            .option('--idempotency-key <key>', 'Retry-safe key. Repeating the same key with the same request replays the first result.');
        return includeExpectedUpdatedAt
            ? configured.option('--expected-updated-at <iso>', "The document's updatedAt as you last read it. Rejects the write if it changed meanwhile.")
            : configured;
    };
    addLeaf('create', 'Create a document', (command) => addWriteContractOptions(command)
        .option('--title <title>', 'Document title')
        .option('--file <path>', 'Read markdown body from a local file')
        .option('--tags <tags>', 'Comma-separated tag suggestions')
        .option('--suggested-tags <tags>', 'Comma-separated AI-suggested tags')
        .option('--visibility <visibility>', 'Document visibility: PRIVATE or PROJECT'));
    addLeaf('update', 'Update a document', (command) => addWriteContractOptions(command, true)
        .option('--id <id>', 'Document ID')
        .option('--title <title>', 'Document title')
        .option('--file <path>', 'Read markdown body from a local file')
        .option('--tags <tags>', 'Comma-separated tag suggestions')
        .option('--suggested-tags <tags>', 'Comma-separated AI-suggested tags')
        .option('--visibility <visibility>', 'Document visibility: PRIVATE or PROJECT'));
    addLeaf('download', 'Download a document', (command) => command.option('--id <id>', 'Document ID'));
    addLeaf('list', 'List documents', (command) => addPaginationOptions(command)
        .option('--query <q>', 'Search query')
        .option('--tags <tags>', 'Comma-separated tag filter')
        .option('--visibility <visibility>', 'Document visibility: PRIVATE or PROJECT')
        .option('--archived <state>', 'Archive filter (ACTIVE, ARCHIVED, ALL)'));
    addLeaf('tags', 'List confirmed document tags', (command) => command
        .option('--visibility <visibility>', 'Document visibility: PRIVATE or PROJECT')
        .option('--archived <state>', 'Archive filter (ACTIVE, ARCHIVED, ALL)'));
    addLeaf('delete', 'Delete a document', (command) => addWriteContractOptions(command, true).option('--id <id>', 'Document ID'));
    addLeaf('archive', 'Archive a document', (command) => command.option('--id <id>', 'Document ID'));
    addLeaf('unarchive', 'Unarchive a document', (command) => command.option('--id <id>', 'Document ID'));
    addLeaf('revisions', 'List document revisions', (command) => addPaginationOptions(command).option('--id <id>', 'Document ID'));
    addLeaf('revision-get', 'Get a document revision', (command) => command.option('--id <id>', 'Document ID').option('--revision-id <id>', 'Document revision ID'));
    addLeaf('revision-restore', 'Restore a document revision', (command) => command.option('--id <id>', 'Document ID').option('--revision-id <id>', 'Document revision ID'));
    addLeaf('comment-list', 'List document comments', (command) => addPaginationOptions(command)
        .option('--id <id>', 'Document ID')
        .option('--order <order>', 'Comment order (asc or desc)'));
    addLeaf('comment-create', 'Create a document comment', (command) => addWriteContractOptions(command)
        .option('--id <id>', 'Document ID')
        .option('--content <text>', 'Markdown comment content')
        .option('--file <path>', 'Read markdown comment content from a local file'));
    addLeaf('comment-update', 'Update a document comment', (command) => addWriteContractOptions(command, true)
        .option('--id <id>', 'Document ID')
        .option('--comment-id <id>', 'Document comment ID')
        .option('--content <text>', 'Markdown comment content')
        .option('--file <path>', 'Read markdown comment content from a local file'));
    addLeaf('comment-delete', 'Delete a document comment', (command) => addWriteContractOptions(command, true)
        .option('--id <id>', 'Document ID')
        .option('--comment-id <id>', 'Document comment ID'));
}
//# sourceMappingURL=document.js.map