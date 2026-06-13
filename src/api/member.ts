import httpClient from '../utils/httpClient.js';

export type MemberQuotaResponse = {
  data: {
    coAction: {
      daily: {
        used: number;
        limit: number;
      };
      monthly: {
        used: number;
        limit: number;
      };
    } | null;
  };
};

export async function getMemberQuota(
  apiUrl: string,
  headers: Record<string, string>,
): Promise<MemberQuotaResponse['data']> {
  const response = await httpClient.get(`${apiUrl}/api/members/quota`, { headers });
  return response.data.data;
}
