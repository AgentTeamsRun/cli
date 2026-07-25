import { searchEntities } from '../api/search.js';
import { toPositiveInteger } from '../utils/parsers.js';
import { buildSearchParams, parseSearchTypes } from '../utils/searchParams.js';
import { withSpinner } from '../utils/spinner.js';

export async function executeSearchCommand(
  apiUrl: string,
  projectId: string,
  headers: any,
  options: Record<string, unknown>,
): Promise<unknown> {
  const query = options.query as string | undefined;
  if (!query?.trim()) {
    throw new Error('--query is required');
  }

  const params = buildSearchParams({
    query: query.trim(),
    types: typeof options.types === 'string' ? parseSearchTypes(options.types) : undefined,
    limit: toPositiveInteger(options.limit),
    maxTokens: toPositiveInteger(options.maxTokens),
  });

  return withSpinner('Searching...', () => searchEntities(apiUrl, projectId, headers, params), 'Search complete');
}
