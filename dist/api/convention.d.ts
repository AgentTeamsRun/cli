/**
 * One page of `GET /conventions`. The paginated `data`/`meta` envelope is
 * returned verbatim — callers own pagination policy (the download flow walks
 * every page, the MCP list tool exposes a single page).
 */
export declare function listConventions(apiUrl: string, projectId: string, headers: Record<string, string>, params?: Record<string, string | number>): Promise<any>;
/** Full single-convention envelope (`GET /conventions/:id`), `contentMarkdown` included. */
export declare function getConvention(apiUrl: string, projectId: string, headers: Record<string, string>, conventionId: string): Promise<any>;
/** Every convention with content in one call (`GET /conventions/download-all`), envelope verbatim. */
export declare function downloadAllConventions(apiUrl: string, projectId: string, headers: Record<string, string>): Promise<any>;
//# sourceMappingURL=convention.d.ts.map