import httpClient from '../utils/httpClient.js';

const getBaseUrl = (apiUrl: string, projectId: string) => {
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalizedApiUrl}/api/projects/${projectId}/conventions`;
};

/**
 * One page of `GET /conventions`. The paginated `data`/`meta` envelope is
 * returned verbatim — callers own pagination policy (the download flow walks
 * every page, the MCP list tool exposes a single page).
 */
export async function listConventions(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  params?: Record<string, string | number>,
): Promise<any> {
  const requestConfig = params && Object.keys(params).length > 0 ? { headers, params } : { headers };
  const response = await httpClient.get(getBaseUrl(apiUrl, projectId), requestConfig);
  return response.data;
}

/** Full single-convention envelope (`GET /conventions/:id`), `contentMarkdown` included. */
export async function getConvention(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  conventionId: string,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/${encodeURIComponent(conventionId)}`, {
    headers,
  });
  return response.data;
}

/** Every convention with content in one call (`GET /conventions/download-all`), envelope verbatim. */
export async function downloadAllConventions(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
): Promise<any> {
  const response = await httpClient.get(`${getBaseUrl(apiUrl, projectId)}/download-all`, { headers });
  return response.data;
}
