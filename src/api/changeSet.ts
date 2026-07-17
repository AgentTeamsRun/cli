import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

const getBaseUrl = (apiUrl: string, projectId: string) => `${apiUrl}/api/projects/${projectId}/change-sets`;

export async function listChangeSetsRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number>,
): Promise<any> {
  const response = await httpClient.get(getBaseUrl(apiUrl, projectId), {
    headers,
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
  });
  return response.data;
}

export async function getChangeSetRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  id: string,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${id}`, { headers });
  return response.data;
}

export async function createChangeSetRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
  return response.data;
}

export async function updateChangeSetRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  id: string,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await httpClient.patch(`${getBaseUrl(apiUrl, projectId)}/${id}`, body, { headers });
  return response.data;
}

export async function deleteChangeSetRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  id: string,
): Promise<any> {
  const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${id}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.status === 204 ? { message: `Change set ${id} deleted.` } : response.data;
}

export async function addChangeSetItemRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  changeSetId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${changeSetId}/items`, body, { headers });
  return response.data;
}

export async function removeChangeSetItemRequest(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  changeSetId: string,
  itemId: string,
): Promise<any> {
  const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${changeSetId}/items/${itemId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.status === 204
    ? { message: `Item ${itemId} removed from change set ${changeSetId}.` }
    : response.data;
}
