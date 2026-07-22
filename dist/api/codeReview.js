import httpClient from '../utils/httpClient.js';
export async function listCodeReviews(apiUrl, projectId, headers, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function getCodeReview(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
    return response.data;
}
export async function getCodeReviewFinding(apiUrl, projectId, headers, findingId, codeReviewId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews/findings/${findingId}`;
    const requestConfig = codeReviewId ? { headers, params: { codeReviewId } } : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function createCodeReview(apiUrl, projectId, headers, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateCodeReview(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.patch(`${baseUrl}/${id}`, body, { headers });
    return response.data;
}
export async function createPlanFromCodeReview(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/plans`, body, { headers });
    return response.data;
}
export async function cancelCodeReview(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/cancel`, {}, { headers });
    return response.data;
}
export async function submitCodeReviewResult(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/result`, body, { headers });
    return response.data;
}
export async function deleteCodeReview(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.delete(`${baseUrl}/${id}`, { headers });
    return response.data;
}
export async function dismissCodeReviewFinding(apiUrl, projectId, headers, id, findingId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/findings/${findingId}/dismiss`, {}, { headers });
    return response.data;
}
export async function resolveCodeReviewFinding(apiUrl, projectId, headers, id, findingId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/findings/${findingId}/resolve`, {}, { headers });
    return response.data;
}
export async function undismissCodeReviewFinding(apiUrl, projectId, headers, id, findingId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
    const response = await httpClient.post(`${baseUrl}/${id}/findings/${findingId}/undismiss`, {}, { headers });
    return response.data;
}
//# sourceMappingURL=codeReview.js.map