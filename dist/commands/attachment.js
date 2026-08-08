import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import axios from '../utils/httpClient.js';
import { printFileSizeInfo } from '../utils/spinner.js';
const requireString = (value, name) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} is required`);
    }
    return value.trim();
};
const optionalString = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    return undefined;
};
const CONTENT_TYPE_BY_EXTENSION = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    log: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    pdf: 'application/pdf',
    html: 'text/html',
    htm: 'text/html',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx']);
const resolveExtension = (fileName) => fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : '';
const resolveContentType = (fileName) => {
    const ext = resolveExtension(fileName);
    const contentType = CONTENT_TYPE_BY_EXTENSION[ext];
    if (!contentType) {
        throw new Error(`Unsupported attachment type ".${ext}". Allowed: ${Object.keys(CONTENT_TYPE_BY_EXTENSION).join(', ')}`);
    }
    return contentType;
};
const resolveTarget = (options) => {
    const codeReviewId = optionalString(options.codeReviewId);
    const completionReportId = optionalString(options.completionReportId);
    const documentId = optionalString(options.documentId);
    const targets = [
        codeReviewId ? { targetType: 'codeReview', targetId: codeReviewId } : null,
        completionReportId ? { targetType: 'completionReport', targetId: completionReportId } : null,
        documentId ? { targetType: 'document', targetId: documentId } : null,
    ].filter((target) => target !== null);
    if (targets.length > 1) {
        throw new Error('Use only one of --code-review-id, --completion-report-id, or --document-id.');
    }
    const target = targets[0];
    if (target) {
        return target;
    }
    throw new Error('Exactly one of --code-review-id, --completion-report-id, or --document-id is required.');
};
export async function executeAttachmentCommand(apiUrl, headers, action, options) {
    if (action === 'list') {
        const triggerId = optionalString(options.triggerId);
        const documentId = optionalString(options.documentId);
        if (triggerId && documentId) {
            throw new Error('Use only one of --trigger-id or --document-id.');
        }
        if (!triggerId && !documentId) {
            throw new Error('Exactly one of --trigger-id or --document-id is required.');
        }
        const path = documentId
            ? `/api/documents/${documentId}/attachments`
            : `/api/daemon-triggers/${triggerId}/attachments`;
        const response = await axios.get(`${apiUrl}${path}`, { headers });
        return response.data;
    }
    if (action === 'create') {
        const filePathOption = requireString(options.file, '--file');
        const { targetType, targetId } = resolveTarget(options);
        const filePath = resolve(filePathOption);
        if (!existsSync(filePath)) {
            throw new Error(`File not found: ${filePathOption}`);
        }
        const buffer = readFileSync(filePath);
        if (buffer.length === 0) {
            throw new Error('Attachment file is empty.');
        }
        const fileName = basename(filePath);
        const contentType = resolveContentType(fileName);
        if (OFFICE_EXTENSIONS.has(resolveExtension(fileName)) && targetType !== 'document') {
            throw new Error('Office attachments are supported only with --document-id.');
        }
        printFileSizeInfo(filePathOption, buffer.length);
        // 1) Presigned draft 업로드 URL 발급
        const draftResponse = await axios.post(`${apiUrl}/api/attachments/draft-upload-url`, { fileName, contentType, size: buffer.length, targetType }, { headers });
        const { uploadUrl, key } = draftResponse.data.data;
        // 2) R2에 파일 바이트 직접 PUT (API 서버를 경유하지 않음)
        await axios.put(uploadUrl, buffer, { headers: { 'Content-Type': contentType } });
        // 3) 서버에 대상 기록과 연결 등록
        const createResponse = await axios.post(`${apiUrl}/api/attachments`, { targetType, targetId, key, originalName: fileName }, { headers });
        return createResponse.data;
    }
    if (action === 'upload' || action === 'delete') {
        throw new Error(`'attachment ${action}' is not supported by the CLI. ` +
            "Use 'attachment create' to upload, or attach during trigger creation via the web UI.");
    }
    throw new Error(`Unknown attachment action: ${action}`);
}
//# sourceMappingURL=attachment.js.map