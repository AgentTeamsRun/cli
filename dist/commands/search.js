import { searchEntities } from '../api/search.js';
import { splitCsv, toPositiveInteger } from '../utils/parsers.js';
import { withSpinner } from '../utils/spinner.js';
const VALID_TYPES = ['PLAN', 'CO_ACTION', 'COMPLETION_REPORT', 'POST_MORTEM', 'CONVENTION'];
export async function executeSearchCommand(apiUrl, projectId, headers, options) {
    const query = options.query;
    if (!query?.trim()) {
        throw new Error('--query is required');
    }
    const params = {
        q: query.trim(),
    };
    if (typeof options.types === 'string') {
        const types = splitCsv(options.types).map((t) => t.toUpperCase());
        const invalid = types.filter((t) => !VALID_TYPES.includes(t));
        if (invalid.length > 0) {
            throw new Error(`Invalid type(s): ${invalid.join(', ')}. Valid types: ${VALID_TYPES.join(', ')}`);
        }
        params.types = types;
    }
    const limit = toPositiveInteger(options.limit);
    if (limit !== undefined)
        params.limit = limit;
    const maxTokens = toPositiveInteger(options.maxTokens);
    if (maxTokens !== undefined)
        params.maxTokens = maxTokens;
    return withSpinner('Searching...', () => searchEntities(apiUrl, projectId, headers, params), 'Search complete');
}
//# sourceMappingURL=search.js.map