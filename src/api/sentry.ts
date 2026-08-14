import httpClient from '../utils/httpClient.js';

const issuesUrl = (apiUrl: string, projectId: string, issueId?: string) =>
  `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/sentry/issues${issueId ? `/${encodeURIComponent(issueId)}` : ''}`;

export async function listSentryIssues(
  apiUrl: string,
  projectId: string,
  headers: any,
  options: { query?: string; cursor?: string; limit?: number },
): Promise<any> {
  const params: Record<string, string | number> = {};
  if (options.query) params.query = options.query;
  if (options.cursor) params.cursor = options.cursor;
  if (options.limit !== undefined) params.limit = options.limit;
  const response = await httpClient.get(issuesUrl(apiUrl, projectId), { headers, params });
  return response.data;
}

export async function getSentryIssue(apiUrl: string, projectId: string, headers: any, issueId: string): Promise<any> {
  const response = await httpClient.get(issuesUrl(apiUrl, projectId, issueId), { headers });
  return response.data;
}
