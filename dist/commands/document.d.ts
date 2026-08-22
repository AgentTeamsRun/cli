type DocumentCommandOptions = {
    id?: string;
    title?: string;
    file?: string;
    tags?: string;
    suggestedTags?: string;
    query?: string;
    visibility?: string;
    archived?: string;
    revisionId?: string;
    commentId?: string;
    content?: string;
    order?: string;
    page?: string | number;
    pageSize?: string | number;
    guideHash?: string;
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
};
/**
 * Fetch a document body and write it under the local document download dir.
 * Shared by `document download` (which formats the text below) and `resolve`,
 * so the file naming stays in one place.
 */
export declare function downloadDocumentToFile(apiUrl: string, projectId: string, headers: Record<string, string>, id: string): Promise<{
    filePath: string;
    id: string;
    title: string;
    webUrl?: string;
}>;
export declare function executeDocumentCommand(apiUrl: string, projectId: string, headers: Record<string, string>, action: string, options: DocumentCommandOptions): Promise<any>;
export {};
//# sourceMappingURL=document.d.ts.map