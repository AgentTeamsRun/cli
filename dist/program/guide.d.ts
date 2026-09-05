import { Command } from './shared.js';
/**
 * 액션 인벤토리: list/get. 실사용 옵션: recordKind, cwd.
 *
 * MCP의 `agentteams_guide_get`과 같은 로더를 쓰는 CLI 경로다. 그 도구는 `full` 툴 프로파일에만
 * 있고 MCP를 아예 안 쓰는 러너도 있어서, 이 명령이 없으면 그런 세션은 가이드에 이름으로 도달할
 * 방법이 없다.
 */
export declare function registerGuideCommand(program: Command): void;
//# sourceMappingURL=guide.d.ts.map