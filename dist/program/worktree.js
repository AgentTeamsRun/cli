import { executeCommand, handleError, printCommandResult } from './shared.js';
export function registerWorktreeCommand(program) {
    const root = program
        .command('worktree')
        .description('Report worktree lifecycle events from a host such as Orca or herdr');
    const addLeaf = (action, description) => {
        const command = root
            .command(action)
            .description(description)
            .option('--repository-id <id>', 'AgentTeams repository ID (optional when remote origin matches)')
            .option('--local-key <key>', 'Opaque worktree identity')
            .option('--event-id <id>', 'Stable event ID for retries')
            .option('--occurred-at <timestamp>', 'Event timestamp in ISO 8601 format')
            .option('--from-herdr-event', 'Read the worktree identity from the herdr plugin event hook payload (HERDR_PLUGIN_EVENT_JSON) instead of the current directory', false)
            .option('--quiet', 'Do not print a successful result', false);
        if (action === 'notify-deleted')
            command.option('--after-removal', 'Send only after the worktree path disappears', false);
        command.action(async (options) => {
            try {
                const result = await executeCommand('worktree', action, { ...options, cwd: process.cwd() });
                if (!options.quiet)
                    printCommandResult({ result, resource: 'worktree', action });
            }
            catch (error) {
                console.error(handleError(error));
                process.exit(1);
            }
        });
    };
    addLeaf('notify-created', 'Report a created worktree');
    addLeaf('notify-deleted', 'Report a deleted worktree');
    // `notify-deleted --after-removal`이 detached 자식으로 다시 부르는 내부 진입점이다.
    // 등록을 빠뜨리면 그 자식이 `unknown command`로 죽어 삭제 이벤트가 조용히 사라진다.
    root
        .command('deliver-deleted', { hidden: true })
        .description('Internal: deliver a deferred deleted event once the worktree path disappears')
        .action(async () => {
        try {
            await executeCommand('worktree', 'deliver-deleted', {});
        }
        catch (error) {
            console.error(handleError(error));
            process.exit(1);
        }
    });
}
//# sourceMappingURL=worktree.js.map