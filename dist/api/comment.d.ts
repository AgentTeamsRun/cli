/**
 * 에이전트 쓰기 계약 필드(전부 선택). 서버 `writeContractProperties`와 짝을 이룬다.
 * 생략하면 요청은 예전과 바이트 단위로 동일하다 — 기존 호출자를 바꾸지 않는다.
 */
export type CommentWriteContract = {
    guideHash?: string;
    idempotencyKey?: string;
};
/**
 * create 전용 도구 축. 서버 `authorAgentConfigIdProperty`와 짝을 이룬다.
 * 행위 주체 축과 직교하며, 값이 없으면 키 자체를 보내지 않는다(빈 문자열은 400을 부른다).
 */
export type CommentAuthorAttribution = {
    agentConfigId?: string;
};
/** update/delete 전용 낙관적 잠금 값까지 포함한 형태. */
export type CommentMutationParams = CommentWriteContract & {
    expectedUpdatedAt?: string;
};
export declare function listComments(apiUrl: string, projectId: string, headers: any, planId: string, params?: Record<string, string | number>): Promise<any>;
export declare function getComment(apiUrl: string, projectId: string, headers: any, commentId: string): Promise<any>;
export declare function createComment(apiUrl: string, projectId: string, headers: any, planId: string, body: {
    type: string;
    content: string;
    affectedFiles?: string[];
} & CommentWriteContract & CommentAuthorAttribution): Promise<any>;
export declare function listFindingComments(apiUrl: string, projectId: string, headers: any, findingId: string, params?: Record<string, string | number>): Promise<any>;
export declare function createFindingComment(apiUrl: string, projectId: string, headers: any, findingId: string, body: {
    content: string;
} & CommentWriteContract & CommentAuthorAttribution): Promise<any>;
export declare function listTaskComments(apiUrl: string, projectId: string, headers: any, taskId: string, params?: Record<string, string | number>): Promise<any>;
export declare function createTaskComment(apiUrl: string, projectId: string, headers: any, taskId: string, body: {
    content: string;
} & CommentWriteContract & CommentAuthorAttribution, planId?: string): Promise<any>;
export declare function updateComment(apiUrl: string, projectId: string, headers: any, commentId: string, body: {
    content: string;
    affectedFiles?: string[];
    expectedUpdatedAt?: string;
} & CommentWriteContract): Promise<any>;
export declare function deleteComment(apiUrl: string, projectId: string, headers: any, commentId: string, params?: CommentMutationParams): Promise<any>;
export declare function listReplies(apiUrl: string, projectId: string, headers: any, commentId: string, params?: Record<string, string | number>): Promise<any>;
export declare function getReply(apiUrl: string, projectId: string, headers: any, replyId: string): Promise<any>;
export declare function createReply(apiUrl: string, projectId: string, headers: any, commentId: string, body: {
    content: string;
} & CommentWriteContract & CommentAuthorAttribution): Promise<any>;
export declare function updateReply(apiUrl: string, projectId: string, headers: any, replyId: string, body: {
    content: string;
    expectedUpdatedAt?: string;
} & CommentWriteContract): Promise<any>;
export declare function deleteReply(apiUrl: string, projectId: string, headers: any, replyId: string, params?: CommentMutationParams): Promise<any>;
//# sourceMappingURL=comment.d.ts.map