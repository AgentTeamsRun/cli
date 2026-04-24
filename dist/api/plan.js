import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
export async function listPlans(apiUrl, projectId, headers, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function getPlan(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
    return response.data;
}
export async function getPlanDependencies(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.get(`${baseUrl}/${id}/dependencies`, { headers });
    return response.data;
}
export async function createPlan(apiUrl, projectId, headers, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updatePlan(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
    return response.data;
}
export async function assignPlan(apiUrl, projectId, headers, id, assignedTo) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${id}/assign`, { assignedTo }, { headers });
    return response.data;
}
export async function startPlanLifecycle(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${id}/start`, body, { headers });
    return response.data;
}
export async function finishPlanLifecycle(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${id}/finish`, body, { headers });
    return response.data;
}
export async function deletePlan(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.delete(`${baseUrl}/${id}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
export async function getPlanStatus(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.get(`${baseUrl}/${id}/status`, { headers });
    return response.data;
}
export async function patchPlanStatus(apiUrl, projectId, headers, id, status) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.patch(`${baseUrl}/${id}/status`, { status }, { headers });
    return response.data;
}
export async function listOriginIssues(apiUrl, projectId, headers, planId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.get(`${baseUrl}/${planId}/origin-issues`, { headers });
    return response.data;
}
export async function linkOriginIssue(apiUrl, projectId, headers, planId, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${planId}/origin-issues`, body, { headers });
    return response.data;
}
export async function unlinkOriginIssue(apiUrl, projectId, headers, planId, issueId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.delete(`${baseUrl}/${planId}/origin-issues/${issueId}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
//# sourceMappingURL=plan.js.map