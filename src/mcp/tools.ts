import {
  getContextToolSpecs,
  SEARCH_TOOL_NAME,
  type ContextToolsClient,
  type ContextToolSpec,
} from '@agentteams/context-tools';
import { getCoAction } from '../api/coaction.js';
import { getCodeReview } from '../api/codeReview.js';
import { getConvention, listConventions } from '../api/convention.js';
import { getDocument } from '../api/document.js';
import { getPlanRunbook } from '../api/plan.js';
import { getPostMortem } from '../api/postmortem.js';
import { getReport } from '../api/report.js';
import { searchEntities } from '../api/search.js';
import type { McpToolContext } from './context.js';

export { SEARCH_TOOL_NAME };
export type McpToolSpec = ContextToolSpec;

/**
 * Bind the transport-independent context-tool contract to the CLI's existing
 * authenticated HTTP functions. MCP envelopes remain in server.ts.
 */
export function createCliContextToolsClient(context: McpToolContext): ContextToolsClient {
  const { apiUrl, projectId, headers } = context;
  return {
    search: (params) => searchEntities(apiUrl, projectId, headers, params),
    getPlan: (id) => getPlanRunbook(apiUrl, projectId, headers, id),
    getCompletionReport: (id) => getReport(apiUrl, projectId, headers, id),
    getCoAction: (id) => getCoAction(apiUrl, projectId, headers, id),
    getPostMortem: (id) => getPostMortem(apiUrl, projectId, headers, id),
    getDocument: (id) => getDocument(apiUrl, projectId, headers, id),
    listConventions: (params) => listConventions(apiUrl, projectId, headers, params),
    getConvention: (id) => getConvention(apiUrl, projectId, headers, id),
    getCodeReview: (id) => getCodeReview(apiUrl, projectId, headers, id),
  };
}

/** Every tool the MCP server exposes, in registration order. */
export function getToolSpecs(): McpToolSpec[] {
  return getContextToolSpecs();
}
