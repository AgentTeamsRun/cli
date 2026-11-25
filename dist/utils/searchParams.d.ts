import { type ContextToolSearchType } from '@agentteams/context-tools';
/**
 * Entity types accepted by `GET /api/projects/:projectId/search`.
 * Runtime catalog is owned by `@agentteams/context-tools`.
 */
export { CONTEXT_TOOL_SEARCH_TYPES as VALID_TYPES } from '@agentteams/context-tools';
export type SearchEntityType = ContextToolSearchType;
export interface SearchParamsInput {
    query: string;
    types?: readonly string[];
    limit?: number;
    maxTokens?: number;
}
/** Parse and validate a comma-separated `--types` value. */
export declare function parseSearchTypes(raw: string): string[];
/**
 * Build the query params for the search endpoint. Shared by the `search`
 * command and the MCP tool so both speak the same contract; optional values are
 * omitted rather than defaulted, leaving the backend defaults authoritative.
 */
export declare function buildSearchParams(input: SearchParamsInput): Record<string, string | number | string[]>;
//# sourceMappingURL=searchParams.d.ts.map