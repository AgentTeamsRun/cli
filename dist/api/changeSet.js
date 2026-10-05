import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
const getBaseUrl = (apiUrl, projectId) => `${apiUrl}/api/projects/${projectId}/change-sets`;
export async function listChangeSetsRequest(apiUrl, projectId, headers, params) {
    const response = await httpClient.get(getBaseUrl(apiUrl, projectId), {
        headers,
        ...(params && Object.keys(params).length > 0 ? { params } : {}),
    });
    return response.data;
}
export async function getChangeSetRequest(apiUrl, projectId, headers, id) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${id}`, { headers });
    return response.data;
}
export async function createChangeSetRequest(apiUrl, projectId, headers, body) {
    const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
    return response.data;
}
export async function updateChangeSetRequest(apiUrl, projectId, headers, id, body) {
    const response = await httpClient.patch(`${getBaseUrl(apiUrl, projectId)}/${id}`, body, { headers });
    return response.data;
}
export async function deleteChangeSetRequest(apiUrl, projectId, headers, id) {
    const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${id}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.status === 204 ? { message: `Change set ${id} deleted.` } : response.data;
}
export async function addChangeSetItemRequest(apiUrl, projectId, headers, changeSetId, body) {
    const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${changeSetId}/items`, body, { headers });
    return response.data;
}
export async function removeChangeSetItemRequest(apiUrl, projectId, headers, changeSetId, itemId) {
    const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${changeSetId}/items/${itemId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.status === 204
        ? { message: `Item ${itemId} removed from change set ${changeSetId}.` }
        : response.data;
}
//# sourceMappingURL=changeSet.js.map