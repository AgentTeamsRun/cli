import { z } from 'zod';
import { getCoAction } from '../api/coaction.js';
import { getConvention, listConventions } from '../api/convention.js';
import { getDocument } from '../api/document.js';
import { getPlanRunbook } from '../api/plan.js';
import { getPostMortem } from '../api/postmortem.js';
import { getReport } from '../api/report.js';
import { searchEntities } from '../api/search.js';
import { stripEntityIdPrefix } from '../utils/entityId.js';
import { buildSearchParams, VALID_TYPES } from '../utils/searchParams.js';
import type { McpToolContext } from './context.js';

export const SEARCH_TOOL_NAME = 'agentteams_search';

const SEARCH_TOOL_DESCRIPTION = [
  'Search AgentTeams entities (plans, co-actions, completion reports, post-mortems, conventions, comments, code reviews, documents) in this project.',
  'Scope: results are limited to the projectId configured for this CLI — the tool cannot search other projects.',
  'Truncation: when the token budget trims the response, meta.truncatedByTokenBudget is true; per-item contentTokenCount tells you what fetching the full entity would cost.',
  'Limitation: under agent API-key authentication the external issue/PR types (GITHUB_ISSUE, GITHUB_PR, GITLAB_ISSUE, GITLAB_MERGE_REQUEST, BITBUCKET_ISSUE, BITBUCKET_PR, LINEAR_ISSUE) always come back empty.',
].join(' ');

/**
 * SDK-agnostic tool description: the handler receives the parsed arguments and
 * the resolved API context, and returns the upstream payload verbatim. Only the
 * SDK adapter (`server.ts`) may wrap results into MCP envelopes — domain
 * handlers must stay free of SDK types so a future SDK upgrade only touches the
 * adapter.
 */
export interface McpToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (args: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
}

const searchToolSpec: McpToolSpec = {
  name: SEARCH_TOOL_NAME,
  title: 'Search AgentTeams',
  description: SEARCH_TOOL_DESCRIPTION,
  // 1:1 with the backend's searchQuerySchema. Defaults for limit/maxTokens
  // stay unset so the backend remains the single source of truth.
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query'),
    types: z.array(z.enum(VALID_TYPES)).optional().describe('Entity types to filter by'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (backend default: 20)'),
    maxTokens: z.number().int().min(1).optional().describe('Token budget for the response'),
  }),
  // The full payload is passed through verbatim: summarizing away `meta` or
  // `partialFailures` would let an agent read a truncated or partially failed
  // search as "no results".
  handler: async (args, context) => {
    return searchEntities(
      context.apiUrl,
      context.projectId,
      context.headers,
      buildSearchParams({
        query: args.query as string,
        types: args.types as string[] | undefined,
        limit: args.limit as number | undefined,
        maxTokens: args.maxTokens as number | undefined,
      }),
    );
  },
};

/**
 * Detail-tool factory: `{ id }` in, upstream envelope out — verbatim. The id
 * accepts both bare uuids and `agentteams_<type>_`-prefixed ids as they appear
 * in search results and web-UI entity references.
 */
function createEntityGetToolSpec(options: {
  name: string;
  title: string;
  description: string;
  idDescription: string;
  fetch: (apiUrl: string, projectId: string, headers: Record<string, string>, id: string) => Promise<unknown>;
}): McpToolSpec {
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: z.object({
      id: z.string().min(1).describe(options.idDescription),
    }),
    handler: async (args, context) => {
      const id = stripEntityIdPrefix(args.id as string);
      return options.fetch(context.apiUrl, context.projectId, context.headers, id);
    },
  };
}

const planGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_plan_get',
  title: 'Get AgentTeams Plan',
  description: [
    'Fetch one plan from this project as its full execution runbook: metadata, the complete contentMarkdown body, structured V2 tasks (including dependsOnTaskIds) and progress.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
    'Responses can be large, so check contentTokenCount on the agentteams_search result before fetching the full plan.',
  ].join(' '),
  idDescription: 'Plan id (bare uuid or agentteams_pln_-prefixed)',
  fetch: getPlanRunbook,
});

const reportGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_report_get',
  title: 'Get AgentTeams Completion Report',
  description: [
    'Fetch one completion report from this project, including its full content and metrics.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
    'Responses can be large, so check contentTokenCount on the agentteams_search result before fetching the full report.',
  ].join(' '),
  idDescription: 'Completion report id (bare uuid or agentteams_rpt_-prefixed)',
  fetch: getReport,
});

const coactionGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_coaction_get',
  title: 'Get AgentTeams Co-Action',
  description: [
    'Fetch one co-action (handoff record) from this project, including its full content.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
    'Responses can be large, so check contentTokenCount on the agentteams_search result before fetching the full co-action.',
  ].join(' '),
  idDescription: 'Co-action id (bare uuid or agentteams_act_-prefixed)',
  fetch: getCoAction,
});

const postmortemGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_postmortem_get',
  title: 'Get AgentTeams Post-Mortem',
  description: [
    'Fetch one post-mortem from this project, including its full content.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
    'Responses can be large, so check contentTokenCount on the agentteams_search result before fetching the full post-mortem.',
  ].join(' '),
  idDescription: 'Post-mortem id (bare uuid or agentteams_pmt_-prefixed)',
  fetch: getPostMortem,
});

const documentGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_document_get',
  title: 'Get AgentTeams Document',
  description: [
    'Fetch one document from this project, including its full body.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
    'Responses can be large, so check contentTokenCount on the agentteams_search result before fetching the full document.',
  ].join(' '),
  idDescription: 'Document id (bare uuid or agentteams_doc_-prefixed)',
  fetch: getDocument,
});

const conventionListToolSpec: McpToolSpec = {
  name: 'agentteams_convention_list',
  title: 'List AgentTeams Conventions',
  description: [
    'List the conventions (coding rules, guides, skills) of this project with optional filters and pagination.',
    'Use agentteams_search to discover relevant conventions; use this tool when you need exact filters or a paginated inventory.',
    'The paginated data/meta envelope is returned verbatim; list items carry metadata only — fetch the full text with agentteams_convention_get.',
  ].join(' '),
  // 1:1 with the backend's conventionQuerySchema (+ paginationQuerySchema);
  // defaults stay unset so the backend remains the single source of truth.
  inputSchema: z.object({
    category: z.string().optional().describe('Filter by category (e.g. rules, skills, guides, references)'),
    scope: z.enum(['PROJECT', 'PERSONAL']).optional().describe('Filter by convention scope'),
    archived: z
      .enum(['ACTIVE', 'ARCHIVED', 'ALL'])
      .optional()
      .describe('Filter by archive state (backend default: ACTIVE)'),
    search: z.string().optional().describe('Keyword filter on title/content'),
    createdByMemberId: z.string().optional().describe('Filter by creator member id'),
    page: z.number().int().min(0).optional().describe('Page number (backend default: 1)'),
    pageSize: z.number().int().min(0).max(100).optional().describe('Page size (backend default: 20)'),
  }),
  handler: async (args, context) => {
    const params: Record<string, string | number> = {};
    for (const key of ['category', 'scope', 'archived', 'search', 'createdByMemberId', 'page', 'pageSize'] as const) {
      const value = args[key];
      if (typeof value === 'string' || typeof value === 'number') params[key] = value;
    }
    return listConventions(context.apiUrl, context.projectId, context.headers, params);
  },
};

const conventionGetToolSpec = createEntityGetToolSpec({
  name: 'agentteams_convention_get',
  title: 'Get AgentTeams Convention',
  description: [
    'Fetch one convention from this project, including its full contentMarkdown.',
    'Pass a convention id from agentteams_search, or use agentteams_convention_list first when you need exact filters.',
    'The upstream payload is returned verbatim — nothing is summarized or omitted.',
  ].join(' '),
  idDescription: 'Convention id (bare uuid or agentteams_cnv_-prefixed)',
  fetch: getConvention,
});

/** Every tool the MCP server exposes, in registration order. */
export function getToolSpecs(): McpToolSpec[] {
  return [
    searchToolSpec,
    planGetToolSpec,
    reportGetToolSpec,
    coactionGetToolSpec,
    postmortemGetToolSpec,
    documentGetToolSpec,
    conventionListToolSpec,
    conventionGetToolSpec,
  ];
}
