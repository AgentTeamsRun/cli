import httpClient from '../utils/httpClient.js';
// The routes pick the project from `request.user.projectId` first and the
// `projectId` query second. Only an agent API key carries the former, so a
// personal-token or JWT session that omits the query has no project to look
// the Linear token up against and comes back 401 — which reads as "expired
// credential" rather than "missing scope". Send it whenever the caller knows it.
// The query stays harmless for agent API keys because the route prefers the
// credential's own project.
const withProjectId = (headers, projectId) => projectId ? { headers, params: { projectId } } : { headers };
// A LINEAR_ISSUE reference locator is not an AgentTeams id, so it is not
// UUID-validated upstream — encode it so it stays a single path segment.
// Every issue-scoped helper builds its URL here so the encoding cannot drift
// back into being asymmetric as helpers are added.
const issueUrl = (apiUrl, issueId, suffix = '') => `${apiUrl}/api/linear/issues/${encodeURIComponent(issueId)}${suffix}`;
export async function getLinearIssue(apiUrl, headers, issueId, projectId) {
    const baseUrl = issueUrl(apiUrl, issueId);
    const response = await httpClient.get(baseUrl, withProjectId(headers, projectId));
    return response.data;
}
export async function createLinearIssue(apiUrl, headers, title, description, state, teamId, parentId, projectId) {
    const baseUrl = `${apiUrl}/api/linear/issues`;
    const body = { title };
    if (teamId)
        body.teamId = teamId;
    if (description)
        body.description = description;
    if (state)
        body.state = state;
    if (parentId)
        body.parentId = parentId;
    const response = await httpClient.post(baseUrl, body, withProjectId(headers, projectId));
    return response.data;
}
export async function updateLinearIssue(apiUrl, headers, issueId, state, projectId) {
    const baseUrl = issueUrl(apiUrl, issueId);
    const response = await httpClient.patch(baseUrl, { state }, withProjectId(headers, projectId));
    return response.data;
}
export async function listLinearComments(apiUrl, headers, issueId, projectId) {
    const baseUrl = issueUrl(apiUrl, issueId, '/comments');
    const response = await httpClient.get(baseUrl, withProjectId(headers, projectId));
    return response.data;
}
export async function createLinearComment(apiUrl, headers, issueId, body, projectId) {
    const baseUrl = issueUrl(apiUrl, issueId, '/comments');
    const response = await httpClient.post(baseUrl, { body }, withProjectId(headers, projectId));
    return response.data;
}
//# sourceMappingURL=linear.js.map