import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

const getBaseUrl = (apiUrl: string, projectId: string) => {
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalizedApiUrl}/api/projects/${projectId}/documents`;
};

const withParams = (headers: Record<string, string>, params?: Record<string, string | number | boolean>) => {
  return params && Object.keys(params).length > 0 ? { headers, params } : { headers };
};

export async function createDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  const response = await httpClient.post(getBaseUrl(apiUrl, projectId), body, { headers });
  return response.data;
}

export async function updateDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  body: Record<string, unknown>,
) {
  const response = await httpClient.put(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, body, { headers });
  return response.data;
}

export async function getDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
) {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, { headers });
  return response.data;
}

export async function downloadDocumentBody(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
) {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/download`, { headers });
  return response.data as string;
}

export async function listDocuments(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number | boolean>,
) {
  const response = await httpClient.get(getBaseUrl(apiUrl, projectId), withParams(headers, params));
  return response.data;
}

export async function listDocumentTags(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number>,
) {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/tags`, withParams(headers, params));
  return response.data;
}

/**
 * DELETE 쓰기 계약 필드. 이 라우트는 본문을 쓰지 않으므로 쿼리로 전달한다
 * (서버 `deleteDocumentQuerySchema`와 짝).
 */
export type DeleteDocumentParams = {
  guideHash?: string;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
};

export async function deleteDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  params?: DeleteDocumentParams,
) {
  const definedParams = Object.fromEntries(
    Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== ''),
  );
  const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${documentId}`, {
    headers: withoutJsonContentType(headers),
    ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
  });
  return response.data;
}

export async function archiveDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
) {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/archive`, {}, { headers });
  return response.data;
}

export async function unarchiveDocument(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
) {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/unarchive`, {}, { headers });
  return response.data;
}

export async function listDocumentRevisions(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  params?: Record<string, string | number>,
) {
  const response = await httpClient.get(
    `${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions`,
    withParams(headers, params),
  );
  return response.data;
}

export async function getDocumentRevision(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  revisionId: string,
) {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions/${revisionId}`, {
    headers,
  });
  return response.data;
}

export async function restoreDocumentRevision(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  revisionId: string,
) {
  const response = await httpClient.post(
    `${getBaseUrl(apiUrl, projectId)}/${documentId}/revisions/${revisionId}/restore`,
    {},
    { headers },
  );
  return response.data;
}

export async function listDocumentComments(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  params?: Record<string, string | number>,
) {
  const response = await httpClient.get(
    `${getBaseUrl(apiUrl, projectId)}/${documentId}/comments`,
    withParams(headers, params),
  );
  return response.data;
}

export async function createDocumentComment(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  body: { content: string; guideHash?: string; idempotencyKey?: string },
) {
  const response = await httpClient.post(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments`, body, { headers });
  return response.data;
}

export async function updateDocumentComment(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  commentId: string,
  body: { content: string; guideHash?: string; idempotencyKey?: string; expectedUpdatedAt?: string },
) {
  const response = await httpClient.put(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments/${commentId}`, body, {
    headers,
  });
  return response.data;
}

export async function deleteDocumentComment(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  documentId: string,
  commentId: string,
  params?: DeleteDocumentParams,
) {
  // 문서 코멘트 삭제도 문서 삭제와 같은 쿼리 계약을 쓴다(서버 deleteDocumentCommentQuerySchema).
  const definedParams = Object.fromEntries(
    Object.entries(params ?? {}).filter(([, value]) => typeof value === 'string' && value.length > 0),
  );
  const response = await httpClient.delete(`${getBaseUrl(apiUrl, projectId)}/${documentId}/comments/${commentId}`, {
    headers: withoutJsonContentType(headers),
    ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
  });
  return response.data;
}
