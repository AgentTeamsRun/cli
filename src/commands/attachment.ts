import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import axios from "../utils/httpClient.js";

const allowedMimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html"
};

const maxAttachmentSizeBytes = 10 * 1024 * 1024;

const getMimeType = (filePath: string) => {
  const lower = filePath.toLowerCase();
  const extension = Object.keys(allowedMimeTypes).find((candidate) => lower.endsWith(candidate));
  return extension ? allowedMimeTypes[extension] : null;
};

const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

export async function executeAttachmentCommand(
  apiUrl: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>
): Promise<unknown> {
  if (action === "upload") {
    const triggerId = requireString(options.triggerId, "--trigger-id");
    const filePath = requireString(options.file, "--file");
    const stat = statSync(filePath);
    if (stat.size > maxAttachmentSizeBytes) {
      throw new Error("File must be 10MB or smaller.");
    }
    const mimeType = getMimeType(filePath);
    if (!mimeType) {
      throw new Error("Unsupported file type.");
    }

    const fileName = basename(filePath);
    const presigned = await axios.post<{ data: { uploadUrl: string; key: string } }>(
      `${apiUrl}/api/attachments/presigned-url`,
      { daemonTriggerId: triggerId, fileName, contentType: mimeType, size: stat.size },
      { headers }
    );

    await axios.put(presigned.data.data.uploadUrl, createReadStream(filePath), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": stat.size
      },
      maxBodyLength: Infinity,
      onUploadProgress: (event) => {
        if (!event.total) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        process.stderr.write(`\rUploading ${percent}%`);
      }
    });
    process.stderr.write("\n");

    const saved = await axios.post(
      `${apiUrl}/api/attachments`,
      { key: presigned.data.data.key, daemonTriggerId: triggerId, originalName: fileName, mimeType },
      { headers }
    );
    return saved.data;
  }

  if (action === "list") {
    const triggerId = requireString(options.triggerId, "--trigger-id");
    const response = await axios.get(`${apiUrl}/api/daemon-triggers/${triggerId}/attachments`, { headers });
    return response.data;
  }

  if (action === "delete") {
    const id = requireString(options.id, "--id");
    await axios.delete(`${apiUrl}/api/attachments/${id}`, { headers });
    return { success: true, id };
  }

  throw new Error(`Unknown attachment action: ${action}`);
}
