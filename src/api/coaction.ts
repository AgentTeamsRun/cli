import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

export async function listCoActions(
  apiUrl: string,
  projectId: string,
  headers: any,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getCoAction(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function createCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updateCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
  return response.data;
}

export async function deleteCoAction(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.delete(`${baseUrl}/${id}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}

export async function listCoActionTakeaways(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function createCoActionTakeaway(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updateCoActionTakeaway(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  takeawayId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
  const response = await httpClient.put(`${baseUrl}/${takeawayId}`, body, { headers });
  return response.data;
}

export async function deleteCoActionTakeaway(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  takeawayId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/takeaways`;
  const response = await httpClient.delete(`${baseUrl}/${takeawayId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}

export async function listCoActionHistories(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions/${coActionId}/histories`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function linkPlanToCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  planId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.post(`${baseUrl}/${coActionId}/plans/${planId}`, {}, { headers });
  return response.data;
}

export async function unlinkPlanFromCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  planId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.delete(`${baseUrl}/${coActionId}/plans/${planId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}

export async function linkCompletionReportToCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  completionReportId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.post(
    `${baseUrl}/${coActionId}/completion-reports/${completionReportId}`,
    {},
    { headers },
  );
  return response.data;
}

export async function unlinkCompletionReportFromCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  completionReportId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.delete(`${baseUrl}/${coActionId}/completion-reports/${completionReportId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}

export async function linkPostMortemToCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  postMortemId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.post(`${baseUrl}/${coActionId}/post-mortems/${postMortemId}`, {}, { headers });
  return response.data;
}

export async function unlinkPostMortemFromCoAction(
  apiUrl: string,
  projectId: string,
  headers: any,
  coActionId: string,
  postMortemId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
  const response = await httpClient.delete(`${baseUrl}/${coActionId}/post-mortems/${postMortemId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}
