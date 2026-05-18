import httpClient from "../utils/httpClient.js";
export async function createFeedback(apiUrl, headers, body) {
    const response = await httpClient.post(`${apiUrl}/api/feedbacks`, body, { headers });
    return response.data;
}
//# sourceMappingURL=feedback.js.map