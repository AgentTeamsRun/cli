export declare function listCodeReviews(apiUrl: string, projectId: string, headers: any, params?: Record<string, string | number>): Promise<any>;
export declare function getCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function getCodeReviewFinding(apiUrl: string, projectId: string, headers: any, findingId: string, codeReviewId?: string): Promise<any>;
export declare function createCodeReview(apiUrl: string, projectId: string, headers: any, body: Record<string, unknown>): Promise<any>;
export declare function updateCodeReview(apiUrl: string, projectId: string, headers: any, id: string, body: Record<string, unknown>): Promise<any>;
export declare function createPlanFromCodeReview(apiUrl: string, projectId: string, headers: any, id: string, body: Record<string, unknown>): Promise<any>;
export declare function cancelCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function submitCodeReviewResult(apiUrl: string, projectId: string, headers: any, id: string, body: Record<string, unknown>): Promise<any>;
export declare function deleteCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function dismissCodeReviewFinding(apiUrl: string, projectId: string, headers: any, id: string, findingId: string): Promise<any>;
export declare function resolveCodeReviewFinding(apiUrl: string, projectId: string, headers: any, id: string, findingId: string): Promise<any>;
export declare function undismissCodeReviewFinding(apiUrl: string, projectId: string, headers: any, id: string, findingId: string): Promise<any>;
//# sourceMappingURL=codeReview.d.ts.map