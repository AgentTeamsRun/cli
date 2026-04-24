import httpClient from '../utils/httpClient.js';
export async function getHarnessConfig(apiUrl, projectId, headers) {
    const response = await httpClient.get(`${apiUrl}/api/harness-configs/${projectId}`, { headers });
    return response.data;
}
export async function updateHarnessConfig(apiUrl, projectId, headers, config) {
    const response = await httpClient.put(`${apiUrl}/api/harness-configs/${projectId}`, { config }, { headers });
    return response.data;
}
//# sourceMappingURL=harnessConfig.js.map