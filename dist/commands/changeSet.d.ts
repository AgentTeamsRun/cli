type RequestContext = {
    apiUrl: string;
    projectId: string;
    headers: Record<string, string>;
};
export declare const listChangeSets: (context: RequestContext, options: Record<string, unknown>) => Promise<any>;
export declare const getChangeSet: (context: RequestContext, id: string) => Promise<any>;
export declare const createChangeSet: (context: RequestContext, title: string, description?: string) => Promise<any>;
export declare const updateChangeSet: (context: RequestContext, id: string, body: Record<string, unknown>) => Promise<any>;
export declare const deleteChangeSet: (context: RequestContext, id: string) => Promise<any>;
export declare const addChangeSetItem: (context: RequestContext, changeSetId: string, mergeOrder: number, options: Record<string, unknown>) => Promise<any>;
export declare const removeChangeSetItem: (context: RequestContext, changeSetId: string, itemId: string) => Promise<any>;
export {};
//# sourceMappingURL=changeSet.d.ts.map