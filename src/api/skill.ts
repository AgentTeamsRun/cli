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

// 공유 발행자 계약 (`/skills/:skillId/shares`, `/skills/:skillId/installs`).

export type SkillShareCreateBody = {
  scope: string;
  targetTeamId?: string;
  includeBody?: boolean;
  includeExecutable?: boolean;
  allowInstall?: boolean;
  expiresAt?: string;
};

/** `POST /skills/:id/shares`. LINK 범위면 응답 `data.token`에 평문 토큰이 **이 한 번만** 실린다. */
export async function createSkillShare(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  body: SkillShareCreateBody,
): Promise<any> {
  const response = await httpClient.post(
    `${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/shares`,
    body,
    {
      headers,
    },
  );
  return response.data;
}

/** `DELETE /skills/:id/shares/:shareId` — 204라 본문이 없다. */
export async function revokeSkillShare(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  shareId: string,
): Promise<void> {
  await httpClient.delete(
    `${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/shares/${encodeURIComponent(shareId)}`,
    { headers },
  );
}

export async function listSkillShares(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(
    `${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/shares`,
    requestConfig,
  );
  return response.data;
}

export async function listSkillInstalls(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  skillId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(
    `${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(skillId)}/installs`,
    requestConfig,
  );
  return response.data;
}

// 소비자 계약. 소비 프로젝트 네임스페이스(`/api/projects/:projectId/skills/shared*`)에서 조회한다.

const getSharedBaseUrl = (apiUrl: string, projectId: string) => {
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalizedApiUrl}/api/projects/${projectId}/skills/shared`;
};

export async function listSharedSkills(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number>,
): Promise<any> {
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(getSharedBaseUrl(apiUrl, projectId), requestConfig);
  return response.data;
}

/** 공유 상세. 파일 목록(경로·크기)만 있고 storageKey는 없다 — 설치 전 미리보기 용도. */
export async function getSharedSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  shareId: string,
): Promise<any> {
  const response = await httpClient.get(`${getSharedBaseUrl(apiUrl, projectId)}/${encodeURIComponent(shareId)}`, {
    headers,
  });
  return response.data;
}

/** `POST /projects/:projectId/skills/install` — 서버 측 복제. 로컬 반영은 `skill download`가 한다. */
export async function installSharedSkill(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  shareId: string,
): Promise<any> {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/install`, { shareId }, { headers });
  return response.data;
}

/** 비인증 공개 링크 조회 (`GET /api/share/skills/:token`). 토큰 미리보기 용도라 인증 헤더를 싣지 않는다. */
export async function getPublicSharedSkill(apiUrl: string, shareToken: string): Promise<any> {
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const response = await httpClient.get(`${normalizedApiUrl}/api/share/skills/${encodeURIComponent(shareToken)}`);
  return response.data;
}

/** 링크 토큰으로 설치 (`POST /projects/:projectId/skills/install { token }`). LINK 공유 전용이다. */
export async function installSharedSkillByToken(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  shareToken: string,
): Promise<any> {
  const response = await httpClient.post(
    `${getBaseUrl(apiUrl, projectId)}/install`,
    { token: shareToken },
    { headers },
  );
  return response.data;
}
