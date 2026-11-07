import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createAttachment, createAttachmentDraftUploadUrl, deleteAttachment, fetchAttachmentBytes, getAttachmentDownloadUrl, listAttachments, putAttachmentBytes, } from '../api/attachment.js';
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
/**
 * 모든 첨부 대상에서 `text/plain`으로 받는 텍스트 확장자.
 * `packages/runner-request/ui/types/attachment.ts`의 `textAttachmentExtensions`와 같은 값이다.
 */
const TEXT_EXTENSIONS = new Set([
    'sql',
    'csv',
    'tsv',
    'json',
    'jsonl',
    'yaml',
    'yml',
    'toml',
    'xml',
    'ini',
    'log',
    'diff',
    'patch',
    'ts',
    'tsx',
    'jsx',
    'py',
    'go',
    'rs',
    'java',
    'kt',
    'swift',
    'c',
    'h',
    'cpp',
    'hpp',
    'cs',
    'rb',
    'php',
    'css',
    'scss',
    'graphql',
    'proto',
    'prisma',
]);
const resolveExtension = (fileName) => fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : '';
const resolveContentType = (fileName) => {
    const ext = resolveExtension(fileName);
    const contentType = CONTENT_TYPE_BY_EXTENSION[ext] ?? (TEXT_EXTENSIONS.has(ext) ? 'text/plain' : undefined);
    if (!contentType) {
        const allowed = new Set([...Object.keys(CONTENT_TYPE_BY_EXTENSION), ...TEXT_EXTENSIONS]);
        throw new Error(`Unsupported attachment type ".${ext}". Allowed: ${[...allowed].join(', ')}`);
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
const LIST_TARGET_FLAGS = '--trigger-id, --document-id, --code-review-id, or --completion-report-id';
const resolveListTarget = (options) => {
    const candidates = [
        ['daemonTrigger', optionalString(options.triggerId)],
        ['document', optionalString(options.documentId)],
        ['codeReview', optionalString(options.codeReviewId)],
        ['completionReport', optionalString(options.completionReportId)],
    ];
    const targets = candidates.filter((candidate) => !!candidate[1]);
    if (targets.length > 1) {
        throw new Error(`Use only one of ${LIST_TARGET_FLAGS}.`);
    }
    const target = targets[0];
    if (!target) {
        throw new Error(`Exactly one of ${LIST_TARGET_FLAGS} is required.`);
    }
    return { targetType: target[0], targetId: target[1] };
};
/**
 * `Content-Disposition`에서 원본 파일명을 꺼낸다. RFC 5987 `filename*`(UTF-8, 한글 이름)을
 * 우선하고, 없으면 ASCII 폴백 `filename`을 쓴다. 서버 형식은
 * `api/src/services/attachment.ts`의 `attachmentContentDisposition`이다.
 */
export const parseContentDispositionFileName = (header) => {
    if (!header)
        return undefined;
    const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
    if (extended) {
        try {
            return decodeURIComponent(extended.trim());
        }
        catch {
            // 잘못 인코딩된 값이면 ASCII 폴백으로 넘어간다.
        }
    }
    return /filename\s*=\s*"([^"]*)"/i.exec(header)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(header)?.[1]?.trim();
};
/** 서버가 준 이름이 경로를 품어도 대상 디렉터리 밖으로 나가지 않도록 마지막 구성 요소만 남긴다. */
const toSafeFileName = (name, fallback) => {
    const base = name ? basename(name.replace(/\\/g, '/')).trim() : '';
    return base.length > 0 && base !== '.' && base !== '..' ? base : fallback;
};
/**
 * `--dest`가 없으면 현재 디렉터리에 원본 이름으로, 기존 디렉터리(또는 `/`로 끝나는 경로)면 그 안에
 * 원본 이름으로, 그 밖에는 파일 경로 그대로 저장한다.
 */
const resolveDownloadPath = (dest, fileName) => {
    if (!dest)
        return resolve(fileName);
    const destPath = resolve(dest);
    const isDirectory = /[\\/]$/.test(dest) || (existsSync(destPath) && statSync(destPath).isDirectory());
    return isDirectory ? join(destPath, fileName) : destPath;
};
export async function executeAttachmentCommand(apiUrl, headers, action, options) {
    if (action === 'list') {
        const { targetType, targetId } = resolveListTarget(options);
        return listAttachments(apiUrl, headers, targetType, targetId);
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
        const { uploadUrl, key } = await createAttachmentDraftUploadUrl(apiUrl, headers, {
            fileName,
            contentType,
            size: buffer.length,
            targetType,
        });
        // 2) R2에 파일 바이트 직접 PUT (API 서버를 경유하지 않음)
        await putAttachmentBytes(uploadUrl, buffer, contentType);
        // 3) 서버에 대상 기록과 연결 등록
        return createAttachment(apiUrl, headers, { targetType, targetId, key, originalName: fileName });
    }
    if (action === 'download') {
        const id = requireString(options.id, '--id');
        const { downloadUrl } = await getAttachmentDownloadUrl(apiUrl, headers, id);
        const { buffer, contentDisposition } = await fetchAttachmentBytes(downloadUrl);
        const fileName = toSafeFileName(parseContentDispositionFileName(contentDisposition), `attachment-${id}`);
        const outputPath = resolveDownloadPath(optionalString(options.dest), fileName);
        if (existsSync(outputPath) && options.force !== true) {
            throw new Error(`File already exists: ${outputPath}. Pass --force to overwrite.`);
        }
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, buffer);
        return {
            message: `Downloaded attachment to ${outputPath}`,
            data: { id, fileName, path: outputPath, size: buffer.length },
        };
    }
    if (action === 'delete') {
        const id = requireString(options.id, '--id');
        await deleteAttachment(apiUrl, headers, id);
        return { message: `Deleted attachment ${id}`, data: { id, deleted: true } };
    }
    if (action === 'upload') {
        throw new Error("'attachment upload' is not supported by the CLI. " +
            "Use 'attachment create' to upload, or attach during trigger creation via the web UI.");
    }
    throw new Error(`Unknown attachment action: ${action}`);
}
//# sourceMappingURL=attachment.js.map