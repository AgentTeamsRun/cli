import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

/**
 * 에이전트 쓰기 계약 필드(전부 선택). 서버 `writeContractProperties`와 짝을 이룬다.
 * 생략하면 요청은 예전과 바이트 단위로 동일하다 — 기존 호출자를 바꾸지 않는다.
 */
export type CommentWriteContract = {
  guideHash?: string;
  idempotencyKey?: string;
};

/**
 * create 전용 도구 축. 서버 `authorAgentConfigIdProperty`와 짝을 이룬다.
 * 행위 주체 축과 직교하며, 값이 없으면 키 자체를 보내지 않는다(빈 문자열은 400을 부른다).
 */
export type CommentAuthorAttribution = {
  agentConfigId?: string;
};

/** update/delete 전용 낙관적 잠금 값까지 포함한 형태. */
export type CommentMutationParams = CommentWriteContract & {
  expectedUpdatedAt?: string;
};

/** 빈 문자열·undefined 를 떨어뜨린다. 서버로 빈 값이 가면 그 자체가 "낡은 해시"로 거절된다. */
const definedContract = (params?: CommentMutationParams): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params ?? {}).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as Record<string, string>;

/** DELETE 는 본문 없이 호출하는 클라이언트가 많아 계약 필드를 쿼리로 싣는다(서버 스키마와 동일). */
const deleteConfig = (headers: any, params?: CommentMutationParams) => {
  const definedParams = definedContract(params);
  return {
    headers: withoutJsonContentType(headers),
    ...(Object.keys(definedParams).length > 0 ? { params: definedParams } : {}),
  };
};

export async function listComments(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}/comments`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getComment(apiUrl: string, projectId: string, headers: any, commentId: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
  const response = await httpClient.get(baseUrl, { headers });
  return response.data;
}

export async function createComment(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string,
  body: {
    type: string;
    content: string;
    affectedFiles?: string[];
  } & CommentWriteContract &
    CommentAuthorAttribution,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}/comments`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function listFindingComments(
  apiUrl: string,
  projectId: string,
  headers: any,
  findingId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews/findings/${findingId}/comments`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function createFindingComment(
  apiUrl: string,
  projectId: string,
  headers: any,
  findingId: string,
  body: { content: string } & CommentWriteContract & CommentAuthorAttribution,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/code-reviews/findings/${findingId}/comments`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function listTaskComments(
  apiUrl: string,
  projectId: string,
  headers: any,
  taskId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/tasks/${taskId}/comments`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function createTaskComment(
  apiUrl: string,
  projectId: string,
  headers: any,
  taskId: string,
  body: { content: string } & CommentWriteContract & CommentAuthorAttribution,
  planId?: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/tasks/${taskId}/comments`;
  const requestConfig = planId ? { headers, params: { planId } } : { headers };
  const response = await httpClient.post(baseUrl, body, requestConfig);
  return response.data;
}

export async function updateComment(
  apiUrl: string,
  projectId: string,
  headers: any,
  commentId: string,
  body: {
    content: string;
    affectedFiles?: string[];
    expectedUpdatedAt?: string;
  } & CommentWriteContract,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
  const response = await httpClient.put(baseUrl, body, { headers });
  return response.data;
}

export async function deleteComment(
  apiUrl: string,
  projectId: string,
  headers: any,
  commentId: string,
  params?: CommentMutationParams,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}`;
  const response = await httpClient.delete(baseUrl, deleteConfig(headers, params));
  return response.data;
}

// ---------------------------------------------------------------------------
// 1-depth 답글(reply) — 플랜/문서 댓글 모두에서 동작한다.
// ---------------------------------------------------------------------------

export async function listReplies(
  apiUrl: string,
  projectId: string,
  headers: any,
  commentId: string,
  params?: Record<string, string | number>,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}/replies`;
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getReply(apiUrl: string, projectId: string, headers: any, replyId: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comment-replies/${replyId}`;
  const response = await httpClient.get(baseUrl, { headers });
  return response.data;
}

export async function createReply(
  apiUrl: string,
  projectId: string,
  headers: any,
  commentId: string,
  body: { content: string } & CommentWriteContract & CommentAuthorAttribution,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comments/${commentId}/replies`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updateReply(
  apiUrl: string,
  projectId: string,
  headers: any,
  replyId: string,
  body: { content: string; expectedUpdatedAt?: string } & CommentWriteContract,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comment-replies/${replyId}`;
  const response = await httpClient.put(baseUrl, body, { headers });
  return response.data;
}

export async function deleteReply(
  apiUrl: string,
  projectId: string,
  headers: any,
  replyId: string,
  params?: CommentMutationParams,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/comment-replies/${replyId}`;
  const response = await httpClient.delete(baseUrl, deleteConfig(headers, params));
  return response.data;
}
