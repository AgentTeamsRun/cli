import { CONTEXT_TOOL_SEARCH_TYPES } from '@agentteams/context-tools';
import { splitCsv } from './parsers.js';
/**
 * Entity types accepted by `GET /api/projects/:projectId/search`.
 * Runtime catalog is owned by `@agentteams/context-tools`.
 */
export { CONTEXT_TOOL_SEARCH_TYPES as VALID_TYPES } from '@agentteams/context-tools';
/** Parse and validate a comma-separated `--types` value. */
export function parseSearchTypes(raw) {
    const types = splitCsv(raw).map((type) => type.toUpperCase());
    const invalid = types.filter((type) => !CONTEXT_TOOL_SEARCH_TYPES.includes(type));
    if (invalid.length > 0) {
        throw new Error(`Invalid type(s): ${invalid.join(', ')}. Valid types: ${CONTEXT_TOOL_SEARCH_TYPES.join(', ')}`);
    }
    return types;
}
/**
 * Build the query params for the search endpoint. Shared by the `search`
 * command and the MCP tool so both speak the same contract; optional values are
 * omitted rather than defaulted, leaving the backend defaults authoritative.
 */
export function buildSearchParams(input) {
    const params = { q: input.query };
    if (input.types !== undefined)
        params.types = [...input.types];
    if (input.limit !== undefined)
        params.limit = input.limit;
    if (input.maxTokens !== undefined)
        params.maxTokens = input.maxTokens;
    return params;
}
//# sourceMappingURL=searchParams.js.map