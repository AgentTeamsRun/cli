import httpClient from '../utils/httpClient.js';
export async function searchEntities(apiUrl, projectId, headers, params) {
    const baseUrl = `${apiUrl}/api/projects/${projectId}/search`;
    // Build URLSearchParams to handle array params (types[])
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
            for (const v of value) {
                searchParams.append(`${key}[]`, v);
            }
        }
        else {
            searchParams.append(key, String(value));
        }
    }
    const url = `${baseUrl}?${searchParams.toString()}`;
    const response = await httpClient.get(url, { headers });
    return response.data;
}
//# sourceMappingURL=search.js.map