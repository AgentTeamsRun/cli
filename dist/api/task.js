import httpClient from '../utils/httpClient.js';
// 자식 전용 포커스 경로. bare agentteams_tsk_<id>는 부모 planId 없이 taskId만으로 조회하고,
// 3-part plan:P:T는 planId를 쿼리로 넘겨 부모 일치로 좁힌다(finding 포커스와 대칭).
export async function getPlanTask(apiUrl, projectId, headers, taskId, planId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/tasks/${taskId}`;
    const requestConfig = planId ? { headers, params: { planId } } : { headers };
    const response = await httpClient.get(baseUrl, requestConfig);
    return response.data;
}
export async function startPlanTask(apiUrl, projectId, headers, planId, taskId) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/start`, {}, { headers });
    return response.data;
}
export async function finishPlanTask(apiUrl, projectId, headers, planId, taskId, status) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
    const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/finish`, { status }, { headers });
    return response.data;
}
//# sourceMappingURL=task.js.map