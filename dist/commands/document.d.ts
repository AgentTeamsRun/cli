type DocumentCommandOptions = {
    id?: string;
    title?: string;
    file?: string;
    tags?: string;
    query?: string;
    visibility?: string;
    archived?: string;
    revisionId?: string;
    commentId?: string;
    content?: string;
    order?: string;
    limit?: string | number;
    page?: string | number;
    pageSize?: string | number;
};
export declare function executeDocumentCommand(apiUrl: string, projectId: string, headers: Record<string, string>, action: string, options: DocumentCommandOptions): Promise<any>;
export {};
//# sourceMappingURL=document.d.ts.map