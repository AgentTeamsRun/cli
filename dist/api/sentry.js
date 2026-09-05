import httpClient from '../utils/httpClient.js';
const issuesUrl = (apiUrl, projectId, issueId) => `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/sentry/issues${issueId ? `/${encodeURIComponent(issueId)}` : ''}`;
export async function listSentryIssues(apiUrl, projectId, headers, options) {
    const params = {};
    if (options.query)
        params.query = options.query;
    if (options.cursor)
        params.cursor = options.cursor;
    if (options.limit !== undefined)
        params.limit = options.limit;
    const response = await httpClient.get(issuesUrl(apiUrl, projectId), { headers, params });
    return response.data;
}
export async function getSentryIssue(apiUrl, projectId, headers, issueId) {
    const response = await httpClient.get(issuesUrl(apiUrl, projectId, issueId), { headers });
    return response.data;
}
//# sourceMappingURL=sentry.js.map