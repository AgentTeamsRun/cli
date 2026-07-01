import httpClient from '../utils/httpClient.js';
export async function getMemberQuota(apiUrl, headers) {
    const response = await httpClient.get(`${apiUrl}/api/members/quota`, { headers });
    return response.data.data;
}
//# sourceMappingURL=member.js.map