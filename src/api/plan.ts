import httpClient from '../utils/httpClient.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

export async function listPlans(
  apiUrl: string,
  projectId: string,
  headers: any,
  params?: Record<string, string | number>
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const requestConfig = params && Object.keys(params).length > 0
    ? { headers, params }
    : { headers };

  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function getPlan(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.get(`${baseUrl}/${id}`, { headers });
  return response.data;
}

export async function getPlanDependencies(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.get(`${baseUrl}/${id}/dependencies`, { headers });
  return response.data;
}

export async function createPlan(
  apiUrl: string,
  projectId: string,
  headers: any,
  body: {
    title: string;
    content: string;
    type?: string;
    priority: string;
    repositoryId?: string;
    status: 'BACKLOG';
  }
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updatePlan(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: Record<string, unknown>
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.put(`${baseUrl}/${id}`, body, { headers });
  return response.data;
}

export async function assignPlan(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  assignedTo: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${id}/assign`, { assignedTo }, { headers });
  return response.data;
}

export async function startPlanLifecycle(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: {
    assignedTo?: string;
    task?: string;
    startCommit?: string;
    startBranch?: string;
  }
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${id}/start`, body, { headers });
  return response.data;
}

export async function finishPlanLifecycle(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  body: {
    task?: string;
    completionReport?: {
      repositoryId?: string;
      title: string;
      content: string;
      commitHash?: string;
      commitStart?: string;
      commitEnd?: string;
      branchName?: string;
      pullRequestId?: string;
      durationSeconds?: number;
      filesModified?: number;
      linesAdded?: number;
      linesDeleted?: number;
      status?: string;
      qualityScore?: number;
    };
  }
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${id}/finish`, body, { headers });
  return response.data;
}

export async function deletePlan(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.delete(`${baseUrl}/${id}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}

export async function getPlanStatus(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.get(`${baseUrl}/${id}/status`, { headers });
  return response.data;
}

export async function patchPlanStatus(
  apiUrl: string,
  projectId: string,
  headers: any,
  id: string,
  status: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.patch(`${baseUrl}/${id}/status`, { status }, { headers });
  return response.data;
}

export async function listOriginIssues(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.get(`${baseUrl}/${planId}/origin-issues`, { headers });
  return response.data;
}

export async function linkOriginIssue(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string,
  body: {
    provider: string;
    externalId: string;
    externalUrl: string;
    externalTitle?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.post(`${baseUrl}/${planId}/origin-issues`, body, { headers });
  return response.data;
}

export async function unlinkOriginIssue(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string,
  issueId: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/projects/${projectId}/plans`;
  const response = await httpClient.delete(`${baseUrl}/${planId}/origin-issues/${issueId}`, {
    headers: withoutJsonContentType(headers),
  });
  return response.data;
}
