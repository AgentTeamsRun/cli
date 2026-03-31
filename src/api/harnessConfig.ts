import httpClient from '../utils/httpClient.js';

export async function getHarnessConfig(
  apiUrl: string,
  projectId: string,
  headers: any
): Promise<any> {
  const response = await httpClient.get(
    `${apiUrl}/api/harness-configs/${projectId}`,
    { headers }
  );
  return response.data;
}

export async function updateHarnessConfig(
  apiUrl: string,
  projectId: string,
  headers: any,
  config: Record<string, unknown>
): Promise<any> {
  const response = await httpClient.put(
    `${apiUrl}/api/harness-configs/${projectId}`,
    { config },
    { headers }
  );
  return response.data;
}
