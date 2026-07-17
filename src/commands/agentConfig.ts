import httpClient from '../utils/httpClient.js';
import { getConfigurationNotFoundMessage, loadConfig } from '../utils/config.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';

function getConfigOrThrow() {
  const config = loadConfig();
  if (!config) {
    throw new Error(getConfigurationNotFoundMessage());
  }
  return config;
}

function getHeaders(apiKey: string) {
  return {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

function getApiBaseUrl(apiUrl: string): string {
  return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
}

export async function agentConfigList(): Promise<any> {
  const config = getConfigOrThrow();
  const apiBaseUrl = getApiBaseUrl(config.apiUrl);
  const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs`, {
    headers: getHeaders(config.apiKey),
  });
  return response.data;
}

export async function agentConfigGet(id: string): Promise<any> {
  const config = getConfigOrThrow();
  const apiBaseUrl = getApiBaseUrl(config.apiUrl);
  const response = await httpClient.get(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs/${id}`, {
    headers: getHeaders(config.apiKey),
  });
  return response.data;
}

export async function agentConfigDelete(id: string): Promise<any> {
  const config = getConfigOrThrow();
  const apiBaseUrl = getApiBaseUrl(config.apiUrl);
  const response = await httpClient.delete(`${apiBaseUrl}/api/projects/${config.projectId}/agent-configs/${id}`, {
    headers: withoutJsonContentType(getHeaders(config.apiKey)),
  });
  if (response.status === 204) {
    return { message: `Agent config ${id} deleted successfully.` };
  }
  return response.data;
}
