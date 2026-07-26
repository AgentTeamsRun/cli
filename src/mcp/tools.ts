import {
  getContextToolSpecs,
  SEARCH_TOOL_NAME,
  type ContextListParams,
  type ContextToolsClient,
  type ContextToolSpec,
} from '@agentteams/context-tools';
import { getCoAction, listCoActions } from '../api/coaction.js';
import { getCodeReview, getCodeReviewFinding, listCodeReviews } from '../api/codeReview.js';
import { getComment, listComments, listFindingComments, listTaskComments } from '../api/comment.js';
import { getConvention, listConventions } from '../api/convention.js';
import { getDocument, listDocuments } from '../api/document.js';
import { getPlanRunbook, listPlans } from '../api/plan.js';
import { getPostMortem, listPostMortems } from '../api/postmortem.js';
import { getReport, listReports } from '../api/report.js';
import { searchEntities } from '../api/search.js';
import type { McpToolContext } from './context.js';

export { SEARCH_TOOL_NAME };
export type McpToolSpec = ContextToolSpec;

type ScalarListParams = Record<string, string | number>;

function scalarListParams(params: ContextListParams): ScalarListParams {
  return params as ScalarListParams;
}

function documentListParams(params: ContextListParams): Record<string, string | number | boolean> {
  return {
    ...params,
    ...(Array.isArray(params.tags) ? { tags: params.tags.join(',') } : {}),
  } as Record<string, string | number | boolean>;
}

/**
 * Bind the transport-independent context-tool contract to the CLI's existing
 * authenticated HTTP functions. MCP envelopes remain in server.ts.
 */
export function createCliContextToolsClient(context: McpToolContext): ContextToolsClient {
  const { apiUrl, projectId, headers } = context;
  return {
    search: (params) => searchEntities(apiUrl, projectId, headers, params),
    listPlans: (params) => listPlans(apiUrl, projectId, headers, scalarListParams(params)),
    getPlan: (id) => getPlanRunbook(apiUrl, projectId, headers, id),
    listCompletionReports: (params) => listReports(apiUrl, projectId, headers, scalarListParams(params)),
    getCompletionReport: (id) => getReport(apiUrl, projectId, headers, id),
    listCoActions: (params) => listCoActions(apiUrl, projectId, headers, scalarListParams(params)),
    getCoAction: (id) => getCoAction(apiUrl, projectId, headers, id),
    listPostMortems: (params) => listPostMortems(apiUrl, projectId, headers, scalarListParams(params)),
    getPostMortem: (id) => getPostMortem(apiUrl, projectId, headers, id),
    listDocuments: (params) => listDocuments(apiUrl, projectId, headers, documentListParams(params)),
    getDocument: (id) => getDocument(apiUrl, projectId, headers, id),
    listConventions: (params) => listConventions(apiUrl, projectId, headers, scalarListParams(params)),
    getConvention: (id) => getConvention(apiUrl, projectId, headers, id),
    listCodeReviews: (params) => listCodeReviews(apiUrl, projectId, headers, scalarListParams(params)),
    getCodeReview: (id) => getCodeReview(apiUrl, projectId, headers, id),
    listComments: (planId, params) => listComments(apiUrl, projectId, headers, planId, scalarListParams(params)),
    listFindingComments: (findingId, params) =>
      listFindingComments(apiUrl, projectId, headers, findingId, scalarListParams(params)),
    listTaskComments: (taskId, params) =>
      listTaskComments(apiUrl, projectId, headers, taskId, scalarListParams(params)),
    getComment: (id) => getComment(apiUrl, projectId, headers, id),
    getCodeReviewFinding: (id, codeReviewId) => getCodeReviewFinding(apiUrl, projectId, headers, id, codeReviewId),
  };
}

/** Every tool the MCP server exposes, in registration order. */
export function getToolSpecs(): McpToolSpec[] {
  return getContextToolSpecs();
}
