import { CONVENTION_HINT } from './shared.js';
import { addGitToggleOption } from './options/completionReport.js';
import { addPaginationOptions } from './options/pagination.js';
import { addJsonResourceLeaf } from './options/resource.js';
import { addMutationContractOptions, addWriteContractOptions } from './options/writeContract.js';
/** 액션 인벤토리: list/get/create/update/delete/download. */
export function registerPostmortemCommand(program) {
    const root = program.command('postmortem').description('Manage post mortems').addHelpText('after', CONVENTION_HINT);
    const addLeaf = (action, description, configure = (command) => command) => addJsonResourceLeaf(root, 'postmortem', action, description, configure);
    const addContent = (command) => command
        .option('--plan-id <id>', 'Plan ID')
        .option('--title <title>', 'Post mortem title')
        .option('--content <content>', 'Post mortem markdown content')
        .option('--file <path>', 'Read postmortem content from a local file')
        .option('--keep-temp', 'Keep the uploaded temporary file', false)
        .option('--action-items <csv>', 'Action items (comma-separated)')
        .option('--status <status>', 'Post mortem status');
    addLeaf('list', 'List post mortems', (command) => addPaginationOptions(command)
        .option('--plan-id <id>', 'Plan ID')
        .option('--status <status>', 'Post mortem status')
        .option('--search <text>', 'Title keyword search'));
    addLeaf('get', 'Get a post mortem', (command) => command.option('--id <id>', 'Post mortem ID'));
    addLeaf('create', 'Create a post mortem', (command) => addWriteContractOptions(addGitToggleOption(addContent(command)), 'post-mortem').option('--repository-remote-url <url>', 'Repository remote origin URL (defaults to git origin)'));
    addLeaf('update', 'Update a post mortem', (command) => addMutationContractOptions(addContent(command.option('--id <id>', 'Post mortem ID')), 'post-mortem', 'post mortem'));
    addLeaf('delete', 'Delete a post mortem', (command) => addMutationContractOptions(command, 'post-mortem', 'post mortem').option('--id <id>', 'Post mortem ID'));
    addLeaf('download', 'Download a post mortem', (command) => command.option('--id <id>', 'Post mortem ID'));
}
//# sourceMappingURL=postmortem.js.map