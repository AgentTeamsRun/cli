import httpClient from '../utils/httpClient.js';
const getBaseUrl = (apiUrl, projectId) => {
    const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    return `${normalizedApiUrl}/api/projects/${projectId}/skills`;
};
/** One page of `GET /skills`. File bodies are **not** included — only metadata and hashes. */
export async function listSkills(apiUrl, projectId, headers, params) {
    const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
    const response = await httpClient.get(getBaseUrl(apiUrl, projectId), requestConfig);
    return response.data;
}
/** Single skill metadata envelope (`GET /skills/:id`). */
export async function getSkill(apiUrl, projectId, headers, skillId) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, { headers });
    return response.data;
}
/** The whole package including file bodies (`GET /skills/:id/download`). */
export async function downloadSkill(apiUrl, projectId, headers, skillId) {
    const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/download`, {
        headers,
    });
    return response.data;
}
export async function createSkill(apiUrl, projectId, headers, body) {
    const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
    return response.data;
}
export async function updateSkill(apiUrl, projectId, headers, skillId, body) {
    const response = await httpClient.patch(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, body, {
        headers,
    });
    return response.data;
}
export async function deleteSkill(apiUrl, projectId, headers, skillId) {
    const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, {
        headers,
    });
    return response.data;
}
//# sourceMappingURL=skill.js.map