import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

export async function listPostMortems(
  apiUrl: string,
  projectId: string,
  headers: any,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getPostMortem(apiUrl: string, projectId: string, headers: any, id: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
  const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function createPostMortem(
  apiUrl: string,
  projectId: string,
  headers: any,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updatePostMortem(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
  const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
  return response.data;
}

export async function deletePostMortem(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  // DELETE는 본문을 쓰지 않으므로 서버가 쓰기 계약 필드를 쿼리로 받는다(deletePostMortemQuerySchema).
  params?: Record<string, string>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
  const definedParams = Object.fromEntries(
    Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== ''),
  );
  const response = await httpClient.delete(`${baseUrl}/${id}`, {
    headers: withoutJsonContentType(headers),
    ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
  });
  return response.data;
}
