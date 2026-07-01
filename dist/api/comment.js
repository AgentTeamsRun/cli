import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
export async function listComments(apiUrl, projectId, headers, planId, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}/comments`;
    const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
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
// ---------------------------------------------------------------------------
// 1-depth 답글(reply) — 플랜/문서 댓글 모두에서 동작한다.
// ---------------------------------------------------------------------------
export async function listReplies(apiUrl, projectId, headers, commentId, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}/replies`;
    const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function createReply(apiUrl, projectId, headers, commentId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}/replies`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateReply(apiUrl, projectId, headers, replyId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comment-replies/${replyId}`;
    const response = await httpClient.put(baseUrl, body, { headers });
    return response.data;
}
export async function deleteReply(apiUrl, projectId, headers, replyId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/comment-replies/${replyId}`;
    const response = await httpClient.delete(baseUrl, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
//# sourceMappingURL=comment.js.map