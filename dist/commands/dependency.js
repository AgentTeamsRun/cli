import httpClient from '../utils/httpClient.js';
import { loadConfig } from '../utils/config.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
function getConfigOrThrow() {
    const config = loadConfig();
    if (!config) {
        throw new Error('Configuration not found. Run "agentteams init" first or set AGENTTEAMS_* environment variables.');
    }
    return config;
}
function getHeaders(apiKey) {
    return {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
    };
}
function getApiBaseUrl(apiUrl) {
    return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
}
export async function dependencyList(planId) {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies`, { headers: getHeaders(config.apiKey) });
    return response.data;
}
export async function dependencyCreate(planId, blockingPlanId) {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.post(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies`, { blockingPlanId }, { headers: getHeaders(config.apiKey) });
    return response.data;
}
export async function dependencyDelete(planId, depId) {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.delete(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies/${depId}`, { headers: withoutJsonContentType(getHeaders(config.apiKey)) });
    if (response.status === 204) {
        return { message: `Dependency ${depId} deleted from plan ${planId}.` };
    }
    return response.data;
}
//# sourceMappingURL=dependency.js.map