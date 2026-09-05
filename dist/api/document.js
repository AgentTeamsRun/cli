import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
const getBaseUrl = (apiUrl, projectId) => {
    const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    return `${normalizedApiUrl}/api/projects/${projectId}/documents`;
};
const withParams = (headers, params) => {
    return params && Object.keys(params).length > 0 ? { headers, params } : { headers };
};
export async function createDocument(apiUrl, projectId, headers, body) {
    const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
    return response.data;
}
export async function updateDocument(apiUrl, projectId, headers, documentId, body) {
    const response = await httpClient.put(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, body, { headers });
    return response.data;
}
export async function getDocument(apiUrl, projectId, headers, documentId) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, { headers });
    return response.data;
}
export async function downloadDocumentBody(apiUrl, projectId, headers, documentId) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/download`, { headers });
    return response.data;
}
export async function listDocuments(apiUrl, projectId, headers, params) {
    const response = await httpClient.get(getBaseUrl(apiUrl, projectId), withParams(headers, params));
    return response.data;
}
export async function listDocumentTags(apiUrl, projectId, headers, params) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/tags`, withParams(headers, params));
    return response.data;
}
export async function deleteDocument(apiUrl, projectId, headers, documentId, params) {
    const definedParams = Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== ''));
    const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, {
        headers: withoutJsonContentType(headers),
        ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
    });
    return response.data;
}
export async function archiveDocument(apiUrl, projectId, headers, documentId) {
    const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/archive`, {}, { headers });
    return response.data;
}
export async function unarchiveDocument(apiUrl, projectId, headers, documentId) {
    const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/unarchive`, {}, { headers });
    return response.data;
}
export async function listDocumentRevisions(apiUrl, projectId, headers, documentId, params) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions`, withParams(headers, params));
    return response.data;
}
export async function getDocumentRevision(apiUrl, projectId, headers, documentId, revisionId) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions/${revisionId}`, {
        headers,
    });
    return response.data;
}
export async function restoreDocumentRevision(apiUrl, projectId, headers, documentId, revisionId) {
    const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions/${revisionId}/restore`, {}, { headers });
    return response.data;
}
export async function listDocumentComments(apiUrl, projectId, headers, documentId, params) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments`, withParams(headers, params));
    return response.data;
}
export async function createDocumentComment(apiUrl, projectId, headers, documentId, body) {
    const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments`, body, { headers });
    return response.data;
}
export async function updateDocumentComment(apiUrl, projectId, headers, documentId, commentId, body) {
    const response = await httpClient.put(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments/${commentId}`, body, {
        headers,
    });
    return response.data;
}
export async function deleteDocumentComment(apiUrl, projectId, headers, documentId, commentId, params) {
    // 문서 코멘트 삭제도 문서 삭제와 같은 쿼리 계약을 쓴다(서버 deleteDocumentCommentQuerySchema).
    const definedParams = Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => typeof value === 'string' && value.length > 0));
    const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments/${commentId}`, {
        headers: withoutJsonContentType(headers),
        ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
    });
    return response.data;
}
//# sourceMappingURL=document.js.map