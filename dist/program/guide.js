import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';
/**
 * 액션 인벤토리: list/get. 실사용 옵션: recordKind, cwd.
 *
 * MCP의 `agentteams_guide_get`과 같은 로더를 쓰는 CLI 경로다. 그 도구는 `full` 툴 프로파일에만
 * 있고 MCP를 아예 안 쓰는 러너도 있어서, 이 명령이 없으면 그런 세션은 가이드에 이름으로 도달할
 * 방법이 없다.
 */
export function registerGuideCommand(program) {
    const root = program
        .command('guide')
        .description('Read the platform guides that govern AgentTeams records')
        .addHelpText('after', CONVENTION_HINT);
    const addLeaf = (name, description, configure = (command) => command) => {
        const command = addOutputOptions(configure(root.command(name).description(description))).addHelpText('after', CONVENTION_HINT);
        command.action(async (options) => {
            try {
                const { outputFile, verbose, ...actionOptions } = options;
                const result = await executeCommand('guide', name, {
                    ...actionOptions,
                    cwd: actionOptions.cwd ?? process.cwd(),
                });
                printCommandResult({ result, resource: 'guide', action: name, outputFile, verbose });
            }
            catch (error) {
                console.error(handleError(error));
                process.exit(1);
            }
        });
    };
    const addCwd = (command) => command.option('--cwd <path>', 'Working directory (defaults to current)');
    addLeaf('list', 'List every guide that can be opened by record kind', addCwd);
    addLeaf('get', 'Fetch the guide for one record kind', (command) => addCwd(command).option('--record-kind <kind>', 'Record kind (see `agentteams guide list`)'));
}
//# sourceMappingURL=guide.js.map