import { getContextToolSpecs, SEARCH_TOOL_NAME, } from '@agentteams/context-tools';
import { getCoAction, listCoActions } from '../api/coaction.js';
import { getCodeReview, getCodeReviewFinding, listCodeReviewFindings, listCodeReviews } from '../api/codeReview.js';
import { getComment, getReply, listComments, listFindingComments, listReplies, listTaskComments, } from '../api/comment.js';
import { getConvention, listConventions } from '../api/convention.js';
import { getDocument, listDocumentComments, listDocuments } from '../api/document.js';
import { getPlanRunbook, listPlans } from '../api/plan.js';
import { getPostMortem, listPostMortems } from '../api/postmortem.js';
import { getReport, listReports } from '../api/report.js';
import { searchEntities } from '../api/search.js';
import { getSkill, listSkills } from '../api/skill.js';
export { SEARCH_TOOL_NAME };
function scalarListParams(params) {
    return params;
}
function documentListParams(params) {
    return {
        ...params,
        ...(Array.isArray(params.tags) ? { tags: params.tags.join(',') } : {}),
    };
}
/**
 * Bind the transport-independent context-tool contract to the CLI's existing
 * authenticated HTTP functions. MCP envelopes remain in server.ts.
 */
export function createCliContextToolsClient(context) {
    const { apiUrl, projectId } = context;
    // Resolved per call, not per client: an MCP server outlives its credential.
    // Without `resolveHeaders` (a static agent key) this is the startup snapshot.
    const auth = () => context.resolveHeaders?.() ?? Promise.resolve(context.headers);
    return {
        search: async (params) => searchEntities(apiUrl, projectId, await auth(), params),
        listPlans: async (params) => listPlans(apiUrl, projectId, await auth(), scalarListParams(params)),
        getPlan: async (id) => getPlanRunbook(apiUrl, projectId, await auth(), id),
        listCompletionReports: async (params) => listReports(apiUrl, projectId, await auth(), scalarListParams(params)),
        getCompletionReport: async (id) => getReport(apiUrl, projectId, await auth(), id),
        listCoActions: async (params) => listCoActions(apiUrl, projectId, await auth(), scalarListParams(params)),
        getCoAction: async (id) => getCoAction(apiUrl, projectId, await auth(), id),
        listPostMortems: async (params) => listPostMortems(apiUrl, projectId, await auth(), scalarListParams(params)),
        getPostMortem: async (id) => getPostMortem(apiUrl, projectId, await auth(), id),
        listDocuments: async (params) => listDocuments(apiUrl, projectId, await auth(), documentListParams(params)),
        getDocument: async (id) => getDocument(apiUrl, projectId, await auth(), id),
        listConventions: async (params) => listConventions(apiUrl, projectId, await auth(), scalarListParams(params)),
        getConvention: async (id) => getConvention(apiUrl, projectId, await auth(), id),
        listSkills: async (params) => listSkills(apiUrl, projectId, await auth(), scalarListParams(params)),
        getSkill: async (id) => getSkill(apiUrl, projectId, await auth(), id),
        listCodeReviews: async (params) => listCodeReviews(apiUrl, projectId, await auth(), scalarListParams(params)),
        getCodeReview: async (id) => getCodeReview(apiUrl, projectId, await auth(), id),
        listCodeReviewFindings: async (codeReviewId, params) => listCodeReviewFindings(apiUrl, projectId, await auth(), codeReviewId, scalarListParams(params)),
        listComments: async (planId, params) => listComments(apiUrl, projectId, await auth(), planId, scalarListParams(params)),
        listFindingComments: async (findingId, params) => listFindingComments(apiUrl, projectId, await auth(), findingId, scalarListParams(params)),
        listTaskComments: async (taskId, params) => listTaskComments(apiUrl, projectId, await auth(), taskId, scalarListParams(params)),
        listDocumentComments: async (documentId, params) => listDocumentComments(apiUrl, projectId, await auth(), documentId, scalarListParams(params)),
        getComment: async (id) => getComment(apiUrl, projectId, await auth(), id),
        listCommentReplies: async (commentId, params) => listReplies(apiUrl, projectId, await auth(), commentId, scalarListParams(params)),
        getCommentReply: async (replyId) => getReply(apiUrl, projectId, await auth(), replyId),
        getCodeReviewFinding: async (id, codeReviewId) => getCodeReviewFinding(apiUrl, projectId, await auth(), id, codeReviewId),
    };
}
/** Every tool the MCP server exposes, in registration order. */
export function getToolSpecs() {
    return getContextToolSpecs();
}
//# sourceMappingURL=tools.js.map