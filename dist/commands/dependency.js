import httpClient from '../utils/httpClient.js';
import { getConfigurationNotFoundMessage, loadConfigWithCredential } from '../utils/config.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
import { buildAuthHeaders } from '../utils/apiContext.js';
async function getConfigOrThrow() {
    // Credential-aware: a personal-token project has no `apiKey` on disk, so the
    // plain config loader would report it as "not initialized".
    const config = await loadConfigWithCredential();
    if (!config) {
        throw new Error(getConfigurationNotFoundMessage());
    }
    return config;
}
function getHeaders(apiKey) {
    return {
        ...buildAuthHeaders(apiKey),
        'Content-Type': 'application/json',
    };
}
function getApiBaseUrl(apiUrl) {
    return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
}
export async function dependencyList(planId) {
    const config = await getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies`, {
        headers: getHeaders(config.apiKey),
    });
    return response.data;
}
export async function dependencyCreate(planId, blockingPlanId) {
    const config = await getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.post(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies`, { blockingPlanId }, { headers: getHeaders(config.apiKey) });
    return response.data;
}
export async function dependencyDelete(planId, depId) {
    const config = await getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.delete(`${apiBaseUrl}/api/projects/${config.projectId}/plans/${planId}/dependencies/${depId}`, { headers: withoutJsonContentType(getHeaders(config.apiKey)) });
    if (response.status === 204) {
        return { message: `Dependency ${depId} deleted from plan ${planId}.` };
    }
    return response.data;
}
//# sourceMappingURL=dependency.js.map