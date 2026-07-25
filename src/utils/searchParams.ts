import { splitCsv } from './parsers.js';

/**
 * Entity types accepted by `GET /api/projects/:projectId/search`.
 * Mirrors the backend's `SearchEntityType` — keep the two in step.
 */
export const VALID_TYPES = [
  'PLAN',
  'CO_ACTION',
  'COMPLETION_REPORT',
  'POST_MORTEM',
  'CONVENTION',
  'COMMENT',
  'CODE_REVIEW',
  'DOCUMENT',
  'GITHUB_ISSUE',
  'GITHUB_PR',
  'GITLAB_ISSUE',
  'GITLAB_MERGE_REQUEST',
  'BITBUCKET_ISSUE',
  'BITBUCKET_PR',
  'LINEAR_ISSUE',
] as const;

export type SearchEntityType = (typeof VALID_TYPES)[number];

export interface SearchParamsInput {
  query: string;
  types?: readonly string[];
  limit?: number;
  maxTokens?: number;
}

/** Parse and validate a comma-separated `--types` value. */
export function parseSearchTypes(raw: string): string[] {
  const types = splitCsv(raw).map((type) => type.toUpperCase());
  const invalid = types.filter((type) => !VALID_TYPES.includes(type as SearchEntityType));
  if (invalid.length > 0) {
    throw new Error(`Invalid type(s): ${invalid.join(', ')}. Valid types: ${VALID_TYPES.join(', ')}`);
  }
  return types;
}

/**
 * Build the query params for the search endpoint. Shared by the `search`
 * command and the MCP tool so both speak the same contract; optional values are
 * omitted rather than defaulted, leaving the backend defaults authoritative.
 */
export function buildSearchParams(input: SearchParamsInput): Record<string, string | number | string[]> {
  const params: Record<string, string | number | string[]> = { q: input.query };

  if (input.types !== undefined) params.types = [...input.types];
  if (input.limit !== undefined) params.limit = input.limit;
  if (input.maxTokens !== undefined) params.maxTokens = input.maxTokens;

  return params;
}
