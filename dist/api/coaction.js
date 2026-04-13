import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
export async function listCoActions(apiUrl, projectId, headers, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function getCoAction(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
    return response.data;
}
export async function createCoAction(apiUrl, projectId, headers, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateCoAction(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
    return response.data;
}
export async function deleteCoAction(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.delete(`${baseUrl}/${id}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
export async function listCoActionTakeaways(apiUrl, projectId, headers, coActionId, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function createCoActionTakeaway(apiUrl, projectId, headers, coActionId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateCoActionTakeaway(apiUrl, projectId, headers, coActionId, takeawayId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
    const response = await httpClient.put(`${baseUrl}/${takeawayId}`, body, { headers });
    return response.data;
}
export async function deleteCoActionTakeaway(apiUrl, projectId, headers, coActionId, takeawayId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
    const response = await httpClient.delete(`${baseUrl}/${takeawayId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
export async function listCoActionHistories(apiUrl, projectId, headers, coActionId, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/histories`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function linkPlanToCoAction(apiUrl, projectId, headers, coActionId, planId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.post(`${baseUrl}/${coActionId}/plans/${planId}`, {}, { headers });
    return response.data;
}
export async function unlinkPlanFromCoAction(apiUrl, projectId, headers, coActionId, planId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.delete(`${baseUrl}/${coActionId}/plans/${planId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
export async function linkCompletionReportToCoAction(apiUrl, projectId, headers, coActionId, completionReportId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.post(`${baseUrl}/${coActionId}/completion-reports/${completionReportId}`, {}, { headers });
    return response.data;
}
export async function unlinkCompletionReportFromCoAction(apiUrl, projectId, headers, coActionId, completionReportId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.delete(`${baseUrl}/${coActionId}/completion-reports/${completionReportId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
export async function linkPostMortemToCoAction(apiUrl, projectId, headers, coActionId, postMortemId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.post(`${baseUrl}/${coActionId}/post-mortems/${postMortemId}`, {}, { headers });
    return response.data;
}
export async function unlinkPostMortemFromCoAction(apiUrl, projectId, headers, coActionId, postMortemId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
    const response = await httpClient.delete(`${baseUrl}/${coActionId}/post-mortems/${postMortemId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
//# sourceMappingURL=coaction.js.map