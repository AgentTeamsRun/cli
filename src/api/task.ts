import httpClient from '../utils/httpClient.js';

export async function startPlanTask(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  planId: string,
  taskId: string,
): Promise<unknown> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/start`, {}, { headers });
  return response.data;
}

export async function finishPlanTask(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  planId: string,
  taskId: string,
  status: string,
): Promise<unknown> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/finish`, { status }, { headers });
  return response.data;
}
