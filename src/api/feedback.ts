import httpClient from '../utils/httpClient.js';

export async function createFeedback(
  apiUrl: string,
  headers: Record<string, string>,
  body: {
    category: string;
    submitterType: 'AI';
    title: string;
    content: string;
  },
): Promise<any> {
  const response = await httpClient.post(`${apiUrl}/api/feedbacks`, body, { headers });
  return response.data;
}
