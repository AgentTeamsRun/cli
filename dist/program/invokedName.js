import { basename } from 'node:path';
/**
 * 별칭(`agt`)은 사람이 터미널에서 직접 치는 이름 전용입니다.
 * MCP 등록 설정·가이드 템플릿·설치 안내에는 정식 이름(`agentteams`)만 씁니다.
 */
export const CANONICAL_CLI_NAME = 'agentteams';
const INVOCATION_NAMES = new Set([CANONICAL_CLI_NAME, 'agt']);
/**
 * 실행 파일명을 화이트리스트로 검증해 도움말에 표시할 프로그램명을 정합니다.
 * basename을 그대로 쓰면 테스트 러너로 실행할 때 프로그램명이 러너 파일명으로 잡혀
 * 도움말 출력이 흔들리므로, 등록된 이름이 아니면 정식 이름으로 폴백합니다.
 *
 * 별칭 이름이 실제로 표시되는 것은 bin을 심링크로 까는 환경(POSIX + npm 전역 설치)뿐입니다.
 * Windows의 `agt.cmd`/`agt.ps1` shim과 pnpm 전역 래퍼는 `node "<...>/dist/index.js"`를 실행해
 * `process.argv[1]`이 항상 진입 스크립트가 되므로, 이 환경에서는 정식 이름으로 폴백합니다(의도된 동작).
 */
export function resolveInvokedName(candidate = basename(process.argv[1] ?? '')) {
    return INVOCATION_NAMES.has(candidate) ? candidate : CANONICAL_CLI_NAME;
}
//# sourceMappingURL=invokedName.js.map