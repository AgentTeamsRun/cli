import { CONVENTION_HINT, createApiKeyFileOption } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';
export function registerSentryCommand(program) {
    const root = program
        .command('sentry')
        .description('Read project-bound Sentry issues through the AgentTeams API')
        .addHelpText('after', CONVENTION_HINT);
    const issue = root.command('issue').description('List or read Sentry issues from the selected project');
    const addConnection = (command) => command
        .option('--api-url <url>', 'Override API URL (optional)')
        .addOption(createApiKeyFileOption())
        .option('--project-id <id>', 'Override AgentTeams project ID (optional)');
    addJsonResourceLeaf(issue, 'sentry', 'list', 'List Sentry issues from the selected project', (command) => addConnection(command)
        .option('--query <query>', 'Sentry issue search/filter query')
        .option('--cursor <cursor>', 'Sentry cursor for the next page')
        .option('--limit <number>', 'Page size from 1 to 100'), { connection: false, commandAction: 'issue-list' });
    addJsonResourceLeaf(issue, 'sentry', 'get', 'Get a Sentry issue', (command) => addConnection(command).option('--issue-id <id>', 'Canonical numeric Sentry issue ID'), { connection: false, commandAction: 'issue-get' });
}
//# sourceMappingURL=sentry.js.map