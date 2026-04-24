import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
export async function listComments(apiUrl, projectId, headers, planId, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}/comments`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function getComment(apiUrl, projectId, headers, commentId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
    const response = await httpClient.get(baseUrl, { headers });
    return response.data;
}
export async function createComment(apiUrl, projectId, headers, planId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}/comments`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateComment(apiUrl, projectId, headers, commentId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
    const response = await httpClient.put(baseUrl, body, { headers });
    return response.data;
}
export async function deleteComment(apiUrl, projectId, headers, commentId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
    const response = await httpClient.delete(baseUrl, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
//# sourceMappingURL=comment.js.map