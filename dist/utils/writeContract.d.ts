/**
 * 에이전트 쓰기 계약 필드(`guideHash` · `idempotencyKey` · `expectedUpdatedAt`)를 요청 본문/쿼리에 싣는다.
 *
 * 명시된 값은 빈 문자열도 담는다 — 서버 스키마(`minLength: 1`)가 잘못된 명시값을 거절해야 한다.
 * `expectedUpdatedAt`을 별도 함수로 가른 이유는 create 계열 스키마가 이 필드를 받지 않기 때문이다
 * (`additionalProperties: false`). 생성 시점에는 비교할 이전 값 자체가 없다.
 */
export type WriteContractOptions = {
    guideHash?: string;
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
};
/** create 계열용: `guideHash` + `idempotencyKey`. */
export declare const writeContractFields: (options: WriteContractOptions) => Record<string, string>;
/** update/delete 계열용: create 계열 + `expectedUpdatedAt`. */
export declare const mutationContractFields: (options: WriteContractOptions) => Record<string, string>;
//# sourceMappingURL=writeContract.d.ts.map