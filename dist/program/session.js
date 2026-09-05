import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';
/**
 * 액션 인벤토리: sync. 실사용 옵션: cwd.
 *
 * `agentteams sync`(사람이 강제로 받는 경로)와 다르다. 이쪽은 세션 시작에 에이전트가 부르는
 * 경로라 **판정을 먼저 하고**, 바뀐 쪽만 받고, 실패해도 정상 종료한다.
 */
export function registerSessionCommand(program) {
    const root = program
        .command('session')
        .description('Session-scoped operations')
        .addHelpText('after', CONVENTION_HINT);
    const command = addOutputOptions(root
        .command('sync')
        .description('Sync conventions and skills for a new session, and report what must be re-read')
        .option('--cwd <path>', 'Working directory (defaults to current)')).addHelpText('after', CONVENTION_HINT);
    command.action(async (options) => {
        try {
            const { outputFile, verbose, ...actionOptions } = options;
            const result = await executeCommand('session', 'sync', {
                ...actionOptions,
                cwd: actionOptions.cwd ?? process.cwd(),
            });
            printCommandResult({ result, resource: 'session', action: 'sync', outputFile, verbose });
        }
        catch (error) {
            // 여기까지 오면 라우팅 자체가 깨진 것이다. `sessionSync`는 동기화 실패를 예외로 올리지
            // 않고 `notes`로 내려보낸다 — 세션 시작이 이 명령 때문에 막히면 안 되기 때문이다.
            console.error(handleError(error));
            process.exit(1);
        }
    });
}
//# sourceMappingURL=session.js.map