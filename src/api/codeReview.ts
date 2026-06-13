import httpClient from '../utils/httpClient.js';

export async function listCodeReviews(
  apiUrl: string,
  projectId: string,
  headers: any,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function createCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updateCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.patch(`${baseUrl}/${id}`, body, { headers });
  return response.data;
}

export async function createPlanFromCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/plans`, body, { headers });
  return response.data;
}

export async function cancelCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/cancel`, {}, { headers });
  return response.data;
}

export async function submitCodeReviewResult(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/result`, body, { headers });
  return response.data;
}

export async function deleteCodeReview(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.delete(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function dismissCodeReviewFinding(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  findingId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/findings/${findingId}/dismiss`, {}, { headers });
  return response.data;
}

export async function undismissCodeReviewFinding(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  findingId: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/findings/${findingId}/undismiss`, {}, { headers });
  return response.data;
}
