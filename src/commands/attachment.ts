import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import axios from "../utils/httpClient.js";
import { printFileSizeInfo } from "../utils/spinner.js";

const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html"
};

const resolveContentType = (fileName: string): string => {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const contentType = CONTENT_TYPE_BY_EXTENSION[ext];
  if (!contentType) {
    throw new Error(
      `Unsupported attachment type ".${ext}". Allowed: ${Object.keys(CONTENT_TYPE_BY_EXTENSION).join(", ")}`
    );
  }
  return contentType;
};

const resolveTarget = (options: Record<string, unknown>): { targetType: "codeReview" | "completionReport"; targetId: string } => {
  const codeReviewId = optionalString(options.codeReviewId);
  const completionReportId = optionalString(options.completionReportId);

  if (codeReviewId && completionReportId) {
    throw new Error("Use only one of --code-review-id or --completion-report-id.");
  }
  if (codeReviewId) {
    return { targetType: "codeReview", targetId: codeReviewId };
  }
  if (completionReportId) {
    return { targetType: "completionReport", targetId: completionReportId };
  }
  throw new Error("Exactly one of --code-review-id or --completion-report-id is required.");
};

export async function executeAttachmentCommand(
  apiUrl: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>
): Promise<unknown> {
  if (action === "list") {
    const triggerId = requireString(options.triggerId, "--trigger-id");
    const response = await axios.get(`${apiUrl}/api/daemon-triggers/${triggerId}/attachments`, { headers });
    return response.data;
  }

  if (action === "create") {
    const filePathOption = requireString(options.file, "--file");
    const { targetType, targetId } = resolveTarget(options);

    const filePath = resolve(filePathOption);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePathOption}`);
    }
    const buffer = readFileSync(filePath);
    if (buffer.length === 0) {
      throw new Error("Attachment file is empty.");
    }

    const fileName = basename(filePath);
    const contentType = resolveContentType(fileName);
    printFileSizeInfo(filePathOption, buffer.length);

    // 1) Presigned draft 업로드 URL 발급
    const draftResponse = await axios.post(
      `${apiUrl}/api/attachments/draft-upload-url`,
      { fileName, contentType, size: buffer.length },
      { headers }
    );
    const { uploadUrl, key } = draftResponse.data.data as { uploadUrl: string; key: string };

    // 2) R2에 파일 바이트 직접 PUT (API 서버를 경유하지 않음)
    await axios.put(uploadUrl, buffer, { headers: { "Content-Type": contentType } });

    // 3) 서버에 대상 기록과 연결 등록
    const createResponse = await axios.post(
      `${apiUrl}/api/attachments`,
      { targetType, targetId, key, originalName: fileName },
      { headers }
    );
    return createResponse.data;
  }

  if (action === "upload" || action === "delete") {
    throw new Error(
      `'attachment ${action}' is not supported by the CLI. ` +
        "Use 'attachment create' to upload, or attach during trigger creation via the web UI."
    );
  }

  throw new Error(`Unknown attachment action: ${action}`);
}
