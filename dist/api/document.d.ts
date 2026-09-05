export declare function createDocument(apiUrl: string, projectId: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<any>;
export declare function updateDocument(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, body: Record<string, unknown>): Promise<any>;
export declare function getDocument(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string): Promise<any>;
export declare function downloadDocumentBody(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string): Promise<string>;
export declare function listDocuments(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number | boolean>): Promise<any>;
export declare function listDocumentTags(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
/**
 * DELETE 쓰기 계약 필드. 이 라우트는 본문을 쓰지 않으므로 쿼리로 전달한다
 * (서버 `deleteDocumentQuerySchema`와 짝).
 */
export type DeleteDocumentParams = {
    guideHash?: string;
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
};
export declare function deleteDocument(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, params?: DeleteDocumentParams): Promise<any>;
export declare function archiveDocument(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string): Promise<any>;
export declare function unarchiveDocument(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string): Promise<any>;
export declare function listDocumentRevisions(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, params?: Record<string, string | number>): Promise<any>;
export declare function getDocumentRevision(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, revisionId: string): Promise<any>;
export declare function restoreDocumentRevision(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, revisionId: string): Promise<any>;
export declare function listDocumentComments(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, params?: Record<string, string | number>): Promise<any>;
export declare function createDocumentComment(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, body: {
    content: string;
    guideHash?: string;
    idempotencyKey?: string;
    agentConfigId?: string;
}): Promise<any>;
export declare function updateDocumentComment(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, commentId: string, body: {
    content: string;
    guideHash?: string;
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
}): Promise<any>;
export declare function deleteDocumentComment(apiUrl: string, projectId: string, headers: Record<string, string>, documentId: string, commentId: string, params?: DeleteDocumentParams): Promise<any>;
//# sourceMappingURL=document.d.ts.map