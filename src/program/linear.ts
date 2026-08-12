import { Command, CONVENTION_HINT, createApiKeyFileOption } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';

export function registerLinearCommand(program: Command): void {
  const root = program
    .command('linear')
    .description('Read Linear issues and add comments through the AgentTeams API')
    .addHelpText('after', CONVENTION_HINT);
  const issue = root.command('issue').description('Read, create, or update a Linear issue');
  const comment = root.command('comment').description('Manage comments on a Linear issue');
  const addConnection = (command: Command) =>
    command
      .option('--api-url <url>', 'Override API URL (optional)')
      .addOption(createApiKeyFileOption())
      .option('--project-id <id>', 'Override AgentTeams project ID (optional)');
  addJsonResourceLeaf(
    issue,
    'linear',
    'get',
    'Get a Linear issue',
    (command) => addConnection(command).option('--issue-id <id>', 'Linear issue ID'),
    { connection: false, commandAction: 'issue-get' },
  );
  addJsonResourceLeaf(
    issue,
    'linear',
    'create',
    'Create a Linear issue',
    (command) =>
      addConnection(command)
        .option('--team-id <id>', 'Linear team ID (not an AgentTeams team ID)')
        .option('--title <text>', 'Issue title')
        .option('--description <text>', 'Issue description')
        .option('--state <name>', 'Issue state name')
        .option('--parent-id <id>', 'Linear parent issue UUID'),
    { connection: false, commandAction: 'issue-create' },
  );
  addJsonResourceLeaf(
    issue,
    'linear',
    'update',
    'Update a Linear issue',
    (command) =>
      addConnection(command).option('--issue-id <id>', 'Linear issue ID').option('--state <name>', 'Issue state name'),
    { connection: false, commandAction: 'issue-update' },
  );
  addJsonResourceLeaf(
    comment,
    'linear',
    'list',
    'List Linear issue comments',
    (command) => addConnection(command).option('--issue-id <id>', 'Linear issue ID'),
    { connection: false, commandAction: 'comment-list' },
  );
  addJsonResourceLeaf(
    comment,
    'linear',
    'create',
    'Create a Linear issue comment',
    (command) =>
      addConnection(command).option('--issue-id <id>', 'Linear issue ID').option('--body <text>', 'Comment body'),
    { connection: false, commandAction: 'comment-create' },
  );
}
