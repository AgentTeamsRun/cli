import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";
import { basename, join, resolve } from "node:path";
import httpClient from "../utils/httpClient.js";
import { withoutJsonContentType } from "../utils/httpHeaders.js";

type DocumentCommandOptions = {
  id?: string;
  title?: string;
  file?: string;
  tags?: string;
  query?: string;
  limit?: string | number;
  page?: string | number;
  pageSize?: string | number;
};

type DocumentRecord = {
  id: string;
  title: string;
  body?: string;
  bodyPreview?: string;
  tags?: string[];
  webUrl?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

const DOCUMENT_DOWNLOAD_DIR = join(".agentteams", "cli", "documents");

const toPositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
};

const normalizeTags = (input?: string) => {
  if (!input) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of input.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  if (result.length > 10) {
    throw new Error("Documents can have up to 10 tags");
  }

  return result;
};

const getBaseUrl = (apiUrl: string, projectId: string) => {
  const normalizedApiUrl = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalizedApiUrl}/api/projects/${projectId}/documents`;
};

const readMarkdownFile = (file: string) => {
  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${file}`);
  }
  return readFileSync(filePath, "utf-8");
};

const titleFromFile = (file: string) => {
  return basename(file)
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Document";
};

const safeFileName = (title: string, id: string) => {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9가-힣_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";
  return `${id.slice(0, 8)}-${slug}.md`;
};

const viewLink = (webUrl?: string | null) => {
  return webUrl ? `[View in AgentTeams](${webUrl})` : null;
};

const formatDocument = (document: DocumentRecord) => {
  return [
    `id: ${document.id}`,
    `title: ${document.title}`,
    document.tags && document.tags.length > 0 ? `tags: ${document.tags.join(", ")}` : null,
    document.updatedAt ? `updatedAt: ${document.updatedAt}` : null,
    viewLink(document.webUrl)
  ].filter(Boolean).join("\n");
};

export async function executeDocumentCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: DocumentCommandOptions
) {
  const baseUrl = getBaseUrl(apiUrl, projectId);

  switch (action) {
    case "create": {
      if (!options.file) throw new Error("--file is required for document create");
      const body = readMarkdownFile(options.file);
      const response = await httpClient.post(baseUrl, {
        title: options.title ?? titleFromFile(options.file),
        body,
        tags: normalizeTags(options.tags)
      }, { headers });
      const document = response.data.data as DocumentRecord;
      return [
        "Document created",
        formatDocument(document)
      ].join("\n");
    }

    case "update": {
      if (!options.id) throw new Error("--id is required for document update");
      const payload: Record<string, unknown> = {};
      if (options.title) payload.title = options.title;
      if (options.file) payload.body = readMarkdownFile(options.file);
      if (options.tags !== undefined) payload.tags = normalizeTags(options.tags);
      if (Object.keys(payload).length === 0) {
        throw new Error("At least one of --title, --file, or --tags is required for document update");
      }

      const response = await httpClient.put(`${baseUrl}/${options.id}`, payload, { headers });
      const document = response.data.data as DocumentRecord;
      return [
        "Document updated",
        formatDocument(document)
      ].join("\n");
    }

    case "download": {
      if (!options.id) throw new Error("--id is required for document download");
      const response = await httpClient.get(`${baseUrl}/${options.id}`, { headers });
      const document = response.data.data as DocumentRecord;
      const outputDir = resolve(DOCUMENT_DOWNLOAD_DIR);
      mkdirSync(outputDir, { recursive: true });
      const outputPath = join(outputDir, safeFileName(document.title, document.id));
      atomicWriteFileSync(outputPath, document.body ?? "", "utf-8");
      return [
        `Document downloaded to ${outputPath}`,
        formatDocument(document)
      ].join("\n");
    }

    case "list": {
      const params: Record<string, string | number> = {};
      if (options.query) params.q = options.query;
      if (options.tags) params.tags = normalizeTags(options.tags).join(",");
      const page = toPositiveInteger(options.page);
      const pageSize = toPositiveInteger(options.pageSize ?? options.limit);
      if (page) params.page = page;
      if (pageSize) params.pageSize = pageSize;

      const response = await httpClient.get(baseUrl, { headers, params });
      const documents = response.data.data as DocumentRecord[];
      if (documents.length === 0) {
        return "No documents found";
      }
      return documents.map(formatDocument).join("\n\n");
    }

    case "delete": {
      if (!options.id) throw new Error("--id is required for document delete");
      await httpClient.delete(`${baseUrl}/${options.id}`, {
        headers: withoutJsonContentType(headers)
      });
      return `Document deleted\nid: ${options.id}`;
    }

    default:
      throw new Error(`Unknown document action: ${action}. Use create, update, download, list, or delete.`);
  }
}
