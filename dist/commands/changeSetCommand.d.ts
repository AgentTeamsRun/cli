type RequestContext = {
    apiUrl: string;
    projectId: string;
    headers: Record<string, string>;
};
export declare function executeChangeSetCommand(context: RequestContext, action: string, options: Record<string, unknown>): Promise<any>;
export {};
//# sourceMappingURL=changeSetCommand.d.ts.map