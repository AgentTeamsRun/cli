import httpClient from '../utils/httpClient.js';

const getBaseUrl = (apiUrl: string, projectId: string) => {
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalizedApiUrl}/api/projects/${projectId}/skills`;
};

/** One page of `GET /skills`. File bodies are **not** included — only metadata and hashes. */
export async function listSkills(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number>,
): Promise<any> {
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(getBaseUrl(apiUrl, projectId), requestConfig);
  return response.data;
}

/** Single skill metadata envelope (`GET /skills/:id`). */
export async function getSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, { headers });
  return response.data;
}

/** The whole package including file bodies (`GET /skills/:id/download`). */
export async function downloadSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/download`, {
    headers,
  });
  return response.data;
}

export async function createSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  body: { slug: string; files: { relativePath: string; content: string }[]; repositoryId?: string; scope?: string },
): Promise<any> {
  const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
  return response.data;
}

export async function updateSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  body: { files: { relativePath: string; content: string }[]; updatedAt: string; scope?: string },
): Promise<any> {
  const response = await httpClient.patch(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, body, {
    headers,
  });
  return response.data;
}

export async function deleteSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
): Promise<any> {
  const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, {
    headers,
  });
  return response.data;
}
