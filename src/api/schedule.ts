import httpClient from '../utils/httpClient.js';

export type SchedulePagination = { page?: number; pageSize?: number };

const schedulesUrl = (apiUrl: string, projectId: string) =>
  `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/runner-schedules`;

const scheduleUrl = (apiUrl: string, projectId: string, id: string) =>
  `${schedulesUrl(apiUrl, projectId)}/${encodeURIComponent(id)}`;

export async function listSchedules(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params: SchedulePagination,
): Promise<unknown> {
  const response = await httpClient.get<unknown>(schedulesUrl(apiUrl, projectId), { headers, params });
  return response.data;
}

export async function getSchedule(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  id: string,
): Promise<unknown> {
  const response = await httpClient.get<unknown>(scheduleUrl(apiUrl, projectId, id), { headers });
  return response.data;
}

export async function listScheduleRuns(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  id: string,
  params: SchedulePagination,
): Promise<unknown> {
  const response = await httpClient.get<unknown>(`${scheduleUrl(apiUrl, projectId, id)}/runs`, { headers, params });
  return response.data;
}
