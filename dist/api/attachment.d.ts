export type AttachmentListTarget = 'daemonTrigger' | 'codeReview' | 'completionReport' | 'document';
export type AttachmentUploadTarget = 'codeReview' | 'completionReport' | 'document';
export declare function listAttachments(apiUrl: string, headers: Record<string, string>, targetType: AttachmentListTarget, targetId: string): Promise<any>;
export declare function createAttachmentDraftUploadUrl(apiUrl: string, headers: Record<string, string>, body: {
    fileName: string;
    contentType: string;
    size: number;
    targetType: AttachmentUploadTarget;
}): Promise<{
    uploadUrl: string;
    key: string;
}>;
/** Raw bytes to a presigned PUT URL (bypasses the API server). */
export declare function putAttachmentBytes(uploadUrl: string, buffer: Buffer, contentType: string): Promise<void>;
export declare function createAttachment(apiUrl: string, headers: Record<string, string>, body: {
    targetType: AttachmentUploadTarget;
    targetId: string;
    key: string;
    originalName: string;
}): Promise<any>;
export declare function getAttachmentDownloadUrl(apiUrl: string, headers: Record<string, string>, attachmentId: string): Promise<{
    downloadUrl: string;
    expiresInSeconds: number;
}>;
/**
 * Raw bytes from a presigned GET URL. The storage response carries the original file name in
 * `Content-Disposition` (the server sets it when it signs the URL), so it is returned alongside.
 */
export declare function fetchAttachmentBytes(downloadUrl: string): Promise<{
    buffer: Buffer;
    contentDisposition: string | undefined;
}>;
export declare function deleteAttachment(apiUrl: string, headers: Record<string, string>, attachmentId: string): Promise<void>;
//# sourceMappingURL=attachment.d.ts.map