import httpClient from '../utils/httpClient.js';
const LIST_PATH_BY_TARGET = {
    daemonTrigger: 'daemon-triggers',
    codeReview: 'code-reviews',
    completionReport: 'completion-reports',
    document: 'documents',
};
export async function listAttachments(apiUrl, headers, targetType, targetId) {
    const response = await httpClient.get(`${apiUrl}/api/${LIST_PATH_BY_TARGET[targetType]}/${targetId}/attachments`, {
        headers,
    });
    return response.data;
}
export async function createAttachmentDraftUploadUrl(apiUrl, headers, body) {
    const response = await httpClient.post(`${apiUrl}/api/attachments/draft-upload-url`, body, { headers });
    return response.data.data;
}
/** Raw bytes to a presigned PUT URL (bypasses the API server). */
export async function putAttachmentBytes(uploadUrl, buffer, contentType) {
    await httpClient.put(uploadUrl, buffer, { headers: { 'Content-Type': contentType } });
}
export async function createAttachment(apiUrl, headers, body) {
    const response = await httpClient.post(`${apiUrl}/api/attachments`, body, { headers });
    return response.data;
}
export async function getAttachmentDownloadUrl(apiUrl, headers, attachmentId) {
    const response = await httpClient.get(`${apiUrl}/api/attachments/${attachmentId}/download-url`, { headers });
    return response.data.data;
}
/**
 * Raw bytes from a presigned GET URL. The storage response carries the original file name in
 * `Content-Disposition` (the server sets it when it signs the URL), so it is returned alongside.
 */
export async function fetchAttachmentBytes(downloadUrl) {
    const response = await httpClient.get(downloadUrl, { responseType: 'arraybuffer' });
    const header = response.headers?.['content-disposition'];
    return {
        buffer: Buffer.from(response.data),
        contentDisposition: typeof header === 'string' ? header : undefined,
    };
}
export async function deleteAttachment(apiUrl, headers, attachmentId) {
    await httpClient.delete(`${apiUrl}/api/attachments/${attachmentId}`, { headers });
}
//# sourceMappingURL=attachment.js.map