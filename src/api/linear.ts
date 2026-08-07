import httpClient from '../utils/httpClient.js';

export async function getLinearIssue(apiUrl: string, headers: any, issueId: string, projectId?: string): Promise<any> {
  // A LINEAR_ISSUE reference locator is not an AgentTeams id, so it is not
  // UUID-validated upstream — encode it so it stays a single path segment.
  const baseUrl = `${apiUrl}/api/linear/issues/${encodeURIComponent(issueId)}`;
  // The route picks the project from `request.user.projectId` first and the
  // `projectId` query second. Only an agent API key carries the former, so a
  // personal-token or JWT session that omits the query has no project to look
  // the Linear token up against and comes back 401 — which reads as "expired
  // credential" rather than "missing scope". Send it whenever the caller knows it.
  const requestConfig = projectId ? { headers, params: { projectId } } : { headers };
  const response = await httpClient.get(baseUrl, requestConfig);
  return response.data;
}

export async function createLinearIssue(
  apiUrl: string,
  headers: any,
  title: string,
  description?: string,
  state?: string,
  teamId?: string,
  parentId?: string,
): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues`;
  const body: Record<string, string> = { title };
  if (teamId) body.teamId = teamId;
  if (description) body.description = description;
  if (state) body.state = state;
  if (parentId) body.parentId = parentId;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function updateLinearIssue(apiUrl: string, headers: any, issueId: string, state: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues/${issueId}`;
  const response = await httpClient.patch(baseUrl, { state }, { headers });
  return response.data;
}

export async function listLinearComments(apiUrl: string, headers: any, issueId: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues/${issueId}/comments`;
  const response = await httpClient.get(baseUrl, { headers });
  return response.data;
}

export async function createLinearComment(apiUrl: string, headers: any, issueId: string, body: string): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues/${issueId}/comments`;
  const response = await httpClient.post(baseUrl, { body }, { headers });
  return response.data;
}
