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
  includeAssets = false,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/download`, {
    headers,
    ...(includeAssets ? { params: { includeAssets: true } } : {}),
  });
  return response.data;
}

export type SkillTextFileBody = { relativePath: string; content: string };
export type SkillNewAssetFileBody = {
  relativePath: string;
  kind: 'BINARY';
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  draftKey: string;
};
export type SkillReuseAssetFileBody = { relativePath: string; kind: 'BINARY'; sha256: string; reuse: true };
export type SkillFileBody = SkillTextFileBody | SkillNewAssetFileBody | SkillReuseAssetFileBody;

export async function createSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  body: {
    slug: string;
    files: SkillFileBody[];
    repositoryId?: string;
    scope?: string;
    assetsAware?: boolean;
  },
): Promise<any> {
  const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
  return response.data;
}

export async function updateSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  body: { files: SkillFileBody[]; updatedAt: string; scope?: string; assetsAware?: boolean },
): Promise<any> {
  const response = await httpClient.patch(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}`, body, {
    headers,
  });
  return response.data;
}

/** Asset upload URL issuance (`POST /skills/asset-upload-urls`). */
export async function requestSkillAssetUploadUrls(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  files: { relativePath: string; sizeBytes: number; mimeType: string; sha256: string }[],
): Promise<{ relativePath: string; draftKey: string; uploadUrl: string }[]> {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/asset-upload-urls`, { files }, { headers });
  return response.data?.data ?? [];
}

/** Raw bytes to a presigned PUT URL (bypasses the API server, like attachment uploads). */
export async function putSkillAssetBytes(uploadUrl: string, buffer: Buffer, contentType: string): Promise<void> {
  await httpClient.put(uploadUrl, buffer, { headers: { 'Content-Type': contentType } });
}

/** Raw bytes from a presigned GET URL. */
export async function fetchSkillAssetBytes(downloadUrl: string): Promise<Buffer> {
  const response = await httpClient.get(downloadUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
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
