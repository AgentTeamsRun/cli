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
export declare function listReplies(apiUrl: string, projectId: string, headers: any, commentId: string, params?: Record<string, string | number>): Promise<any>;
export declare function createReply(apiUrl: string, projectId: string, headers: any, commentId: string, body: {
    content: string;
}): Promise<any>;
export declare function updateReply(apiUrl: string, projectId: string, headers: any, replyId: string, body: {
    content: string;
}): Promise<any>;
export declare function deleteReply(apiUrl: string, projectId: string, headers: any, replyId: string): Promise<any>;
//# sourceMappingURL=comment.d.ts.map