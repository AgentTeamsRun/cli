import httpClient from '../utils/httpClient.js';

export async function getLinearIssue(
  apiUrl: string,
  headers: any,
  issueId: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues/${issueId}`;
  const response = await httpClient.get(baseUrl, { headers });
  return response.data;
}

export async function createLinearIssue(
  apiUrl: string,
  headers: any,
  teamId: string,
  title: string,
  description?: string,
  state?: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues`;
  const body: Record<string, string> = { teamId, title };
  if (description) body.description = description;
  if (state) body.state = state;
  const response = await httpClient.post(baseUrl, body, { headers });
  return response.data;
}

export async function createLinearComment(
  apiUrl: string,
  headers: any,
  issueId: string,
  body: string
): Promise<any> {
  const baseUrl = `${apiUrl}/api/linear/issues/${issueId}/comments`;
  const response = await httpClient.post(baseUrl, { body }, { headers });
  return response.data;
}
