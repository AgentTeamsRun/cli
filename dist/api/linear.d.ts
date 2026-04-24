export declare function getLinearIssue(apiUrl: string, headers: any, issueId: string): Promise<any>;
export declare function createLinearIssue(apiUrl: string, headers: any, title: string, description?: string, state?: string, teamId?: string, parentId?: string): Promise<any>;
export declare function updateLinearIssue(apiUrl: string, headers: any, issueId: string, state: string): Promise<any>;
export declare function listLinearComments(apiUrl: string, headers: any, issueId: string): Promise<any>;
export declare function createLinearComment(apiUrl: string, headers: any, issueId: string, body: string): Promise<any>;
//# sourceMappingURL=linear.d.ts.map