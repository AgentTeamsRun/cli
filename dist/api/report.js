import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
export async function listReports(apiUrl, projectId, headers, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/completion-reports`;
    const requestConfig = params && Object.keys(params).length > 0
        ? { headers, params }
        : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function getReport(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/completion-reports`;
    const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
    return response.data;
}
export async function createReport(apiUrl, projectId, headers, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/completion-reports`;
    const response = await httpClient.post(baseUrl, body, { headers });
    return response.data;
}
export async function updateReport(apiUrl, projectId, headers, id, body) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/completion-reports`;
    const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
    return response.data;
}
export async function deleteReport(apiUrl, projectId, headers, id) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/completion-reports`;
    const response = await httpClient.delete(`${baseUrl}/${id}`, {
        headers: withoutJsonContentType(headers),
    });
    return response.data;
}
//# sourceMappingURL=report.js.map