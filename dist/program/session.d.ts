import { Command } from './shared.js';
/**
 * 액션 인벤토리: sync. 실사용 옵션: cwd.
 *
 * `agentteams sync`(사람이 강제로 받는 경로)와 다르다. 이쪽은 세션 시작에 에이전트가 부르는
 * 경로라 **판정을 먼저 하고**, 바뀐 쪽만 받고, 실패해도 정상 종료한다.
 */
export declare function registerSessionCommand(program: Command): void;
//# sourceMappingURL=session.d.ts.map