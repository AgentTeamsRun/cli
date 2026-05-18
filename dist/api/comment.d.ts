export declare function listComments(apiUrl: string, projectId: string, headers: any, planId: string, params?: Record<string, string | number>): Promise<any>;
export declare function getComment(apiUrl: string, projectId: string, headers: any, commentId: string): Promise<any>;
export declare function createComment(apiUrl: string, projectId: string, headers: any, planId: string, body: {
    type: string;
    content: string;
    affectedFiles?: string[];
}): Promise<any>;
export declare function updateComment(apiUrl: string, projectId: string, headers: any, commentId: string, body: {
    content: string;
    affectedFiles?: string[];
}): Promise<any>;
export declare function deleteComment(apiUrl: string, projectId: string, headers: any, commentId: string): Promise<any>;
//# sourceMappingURL=comment.d.ts.map