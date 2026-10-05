import httpClient from '../utils/httpClient.js';

// 자식 전용 포커스 경로. bare agentteams_tsk_<id>는 부모 planId 없이 taskId만으로 조회하고,
// 3-part plan:P:T는 planId를 쿼리로 넘겨 부모 일치로 좁힌다(finding 포커스와 대칭).
export async function getPlanTask(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  taskId: string,
  planId?: string,
): Promise<unknown> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans/tasks/${encodeURIComponent(taskId)}`;
  const requestConfig = planId ? { headers, params: { planId } } : { headers };
  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function startPlanTask(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  planId: string,
  taskId: string,
): Promise<unknown> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/start`, {}, { headers });
  return response.data;
}

export type PlanTaskFinishGit = {
  commit: string;
  branch: string | null;
  commitOnRemote: boolean | null;
};

// 태스크 보고서. title을 생략하면 서버가 `Task {N}. {태스크 제목}`으로 채운다.
export type PlanTaskFinishReport = {
  title?: string;
  content: string;
  status: string;
  repositoryRemoteUrl?: string;
  commitHash?: string;
  commitStart?: string;
  commitEnd?: string;
  branchName?: string;
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
  qualityScore?: number;
  reviewRecommendation?: string;
  reviewReason?: string;
};

export type PlanTaskFinishReportAttachment = {
  completionReport: PlanTaskFinishReport;
  runnerType: string;
  model: string;
  fastMode?: boolean;
};

export async function finishPlanTask(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  planId: string,
  taskId: string,
  status: string,
  git?: PlanTaskFinishGit,
  report?: PlanTaskFinishReportAttachment,
): Promise<unknown> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const body = { status, ...(git ? { git } : {}), ...(report ?? {}) };
  const response = await httpClient.post(`${baseUrl}/${planId}/tasks/${taskId}/finish`, body, { headers });
  return response.data;
}
