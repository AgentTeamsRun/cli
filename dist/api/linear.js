import httpClient from '../utils/httpClient.js';
export async function getLinearIssue(apiUrl, headers, issueId) {
    const baseUrl = `${apiUrl}/api/linear/issues/${issueId}`;
    const response = await httpClient.get(baseUrl, { headers });
    return response.data;
}
export async function createLinearIssue(apiUrl, headers, title, description, state, teamId, parentId) {
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
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateLinearIssue(apiUrl, headers, issueId, state) {
    const baseUrl = `${apiUrl}/api/linear/issues/${issueId}`;
    const response = await httpClient.patch(baseUrl, { state }, { headers });
    return response.data;
}
export async function listLinearComments(apiUrl, headers, issueId) {
    const baseUrl = `${apiUrl}/api/linear/issues/${issueId}/comments`;
    const response = await httpClient.get(baseUrl, { headers });
    return response.data;
}
export async function createLinearComment(apiUrl, headers, issueId, body) {
    const baseUrl = `${apiUrl}/api/linear/issues/${issueId}/comments`;
    const response = await httpClient.post(baseUrl, { body }, { headers });
    return response.data;
}
//# sourceMappingURL=linear.js.map