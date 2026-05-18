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
export async function agentConfigList() {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs`, { headers: getHeaders(config.apiKey) });
    return response.data;
}
export async function agentConfigGet(id) {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs/${id}`, { headers: getHeaders(config.apiKey) });
    return response.data;
}
export async function agentConfigDelete(id) {
    const config = getConfigOrThrow();
    const apiBaseUrl = getApiBaseUrl(config.apiUrl);
    const response = await httpClient.delete(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs/${id}`, { headers: withoutJsonContentType(getHeaders(config.apiKey)) });
    if (response.status === 204) {
        return { message: `Agent config ${id} deleted successfully.` };
    }
    return response.data;
}
//# sourceMappingURL=agentConfig.js.map