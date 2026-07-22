export declare function listChangeSetsRequest(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
export declare function getChangeSetRequest(apiUrl: string, projectId: string, headers: Record<string, string>, id: string): Promise<any>;
export declare function createChangeSetRequest(apiUrl: string, projectId: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<any>;
export declare function updateChangeSetRequest(apiUrl: string, projectId: string, headers: Record<string, string>, id: string, body: Record<string, unknown>): Promise<any>;
export declare function deleteChangeSetRequest(apiUrl: string, projectId: string, headers: Record<string, string>, id: string): Promise<any>;
export declare function addChangeSetItemRequest(apiUrl: string, projectId: string, headers: Record<string, string>, changeSetId: string, body: Record<string, unknown>): Promise<any>;
export declare function removeChangeSetItemRequest(apiUrl: string, projectId: string, headers: Record<string, string>, changeSetId: string, itemId: string): Promise<any>;
//# sourceMappingURL=changeSet.d.ts.map