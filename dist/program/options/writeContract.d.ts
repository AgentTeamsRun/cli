import type { Command } from 'commander';
/**
 * 에이전트 쓰기 계약 3종 플래그.
 *
 * MCP 쓰기 도구와 CLI는 같은 엔드포인트를 부른다. 한쪽에만 이 플래그가 있으면
 * "MCP를 쓸 수 없을 때 CLI로 대체해도 계약이 같다"는 플랫폼 가이드의 fallback 서술이
 * 그 엔티티에서만 거짓이 된다. 서버가 받는 표면에는 두 경로 모두에 플래그를 둔다.
 */
export declare function addWriteContractOptions(command: Command, guideName: string): Command;
/**
 * update/delete 계열용. create 계열에는 `--expected-updated-at`을 두지 않는다 —
 * 생성 시점에는 비교할 이전 값이 없고, 서버 create 스키마도 이 필드를 받지 않는다.
 */
export declare function addMutationContractOptions(command: Command, guideName: string, recordName: string): Command;
//# sourceMappingURL=writeContract.d.ts.map