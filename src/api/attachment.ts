import httpClient from '../utils/httpClient.js';

export type AttachmentListTarget = 'daemonTrigger' | 'codeReview' | 'completionReport' | 'document';
export type AttachmentUploadTarget = 'codeReview' | 'completionReport' | 'document';

const LIST_PATH_BY_TARGET: Record<AttachmentListTarget, string> = {
  daemonTrigger: 'daemon-triggers',
  codeReview: 'code-reviews',
  completionReport: 'completion-reports',
  document: 'documents',
};

export async function listAttachments(
  apiUrl: string,
  headers: Record<string, string>,
  targetType: AttachmentListTarget,
  targetId: string,
): Promise<any> {
  const response = await httpClient.get(`${apiUrl}/api/${LIST_PATH_BY_TARGET[targetType]}/${targetId}/attachments`, {
    headers,
  });
  return response.data;
}

export async function createAttachmentDraftUploadUrl(
  apiUrl: string,
  headers: Record<string, string>,
  body: { fileName: string; contentType: string; size: number; targetType: AttachmentUploadTarget },
): Promise<{ uploadUrl: string; key: string }> {
  const response = await httpClient.post(`${apiUrl}/api/attachments/draft-upload-url`, body, { headers });
  return response.data.data as { uploadUrl: string; key: string };
}

/** Raw bytes to a presigned PUT URL (bypasses the API server). */
export async function putAttachmentBytes(uploadUrl: string, buffer: Buffer, contentType: string): Promise<void> {
  await httpClient.put(uploadUrl, buffer, { headers: { 'Content-Type': contentType } });
}

export async function createAttachment(
  apiUrl: string,
  headers: Record<string, string>,
  body: { targetType: AttachmentUploadTarget; targetId: string; key: string; originalName: string },
): Promise<any> {
  const response = await httpClient.post(`${apiUrl}/api/attachments`, body, { headers });
  return response.data;
}

export async function getAttachmentDownloadUrl(
  apiUrl: string,
  headers: Record<string, string>,
  attachmentId: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  const response = await httpClient.get(`${apiUrl}/api/attachments/${attachmentId}/download-url`, { headers });
  return response.data.data as { downloadUrl: string; expiresInSeconds: number };
}

/**
 * Raw bytes from a presigned GET URL. The storage response carries the original file name in
 * `Content-Disposition` (the server sets it when it signs the URL), so it is returned alongside.
 */
export async function fetchAttachmentBytes(
  downloadUrl: string,
): Promise<{ buffer: Buffer; contentDisposition: string | undefined }> {
  const response = await httpClient.get(downloadUrl, { responseType: 'arraybuffer' });
  const header = response.headers?.['content-disposition'];
  return {
    buffer: Buffer.from(response.data),
    contentDisposition: typeof header === 'string' ? header : undefined,
  };
}

export async function deleteAttachment(
  apiUrl: string,
  headers: Record<string, string>,
  attachmentId: string,
): Promise<void> {
  await httpClient.delete(`${apiUrl}/api/attachments/${attachmentId}`, { headers });
}
