import httpClient from '../utils/httpClient.js';
const schedulesUrl = (apiUrl, projectId) => `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/runner-schedules`;
const scheduleUrl = (apiUrl, projectId, id) => `${schedulesUrl(apiUrl, projectId)}/${encodeURIComponent(id)}`;
export async function listSchedules(apiUrl, projectId, headers, params) {
    const response = await httpClient.get(schedulesUrl(apiUrl, projectId), { headers, params });
    return response.data;
}
export async function getSchedule(apiUrl, projectId, headers, id) {
    const response = await httpClient.get(scheduleUrl(apiUrl, projectId, id), { headers });
    return response.data;
}
export async function listScheduleRuns(apiUrl, projectId, headers, id, params) {
    const response = await httpClient.get(`${scheduleUrl(apiUrl, projectId, id)}/runs`, { headers, params });
    return response.data;
}
//# sourceMappingURL=schedule.js.map