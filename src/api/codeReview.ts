import httpClient from '../utils/httpClient.js';

export async function listCodeReviews(
  apiUrl: string,
  projectId: string,
  headers: any,
  params?: Record<string, string | number>
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const requestConfig = params && Object.keys(params).length > 0
    ? { headers, params }
    : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function createCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  body: Record<string, unknown>
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function createPlanFromCodeReview(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;
  const response = await httpClient.post(`${baseUrl}/${id}/plans`, body, { headers });
  return response.data;
}
