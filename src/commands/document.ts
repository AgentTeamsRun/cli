import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '../utils/atomicWrite.js';
import { basename, join, resolve } from 'node:path';
import {
  archiveDocument,
  createDocument,
  createDocumentComment,
  deleteDocument,
  deleteDocumentComment,
  downloadDocumentBody,
  getDocument,
  getDocumentRevision,
  listDocumentComments,
  listDocumentRevisions,
  listDocumentTags,
  listDocuments,
  restoreDocumentRevision,
  unarchiveDocument,
  updateDocument,
  updateDocumentComment,
} from '../api/document.js';

type DocumentCommandOptions = {
  id?: string;
  title?: string;
  file?: string;
  tags?: string;
  suggestedTags?: string;
  query?: string;
  visibility?: string;
  archived?: string;
  revisionId?: string;
  commentId?: string;
  content?: string;
  order?: string;
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
  visibility?: string;
  archivedAt?: string | null;
  webUrl?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

type DocumentRevisionRecord = {
  id: string;
  revisionNumber?: number;
  title?: string;
  body?: string;
  bodyPreview?: string;
  createdAt?: string;
  createdBy?: { nickname?: string | null } | null;
};

type DocumentCommentRecord = {
  id: string;
  content?: string;
  contentMarkdown?: string;
  createdByName?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const DOCUMENT_DOWNLOAD_DIR = join('.agentteams', 'cli', 'documents');
const VISIBILITY_VALUES = ['PROJECT', 'PRIVATE'] as const;
const ARCHIVED_VALUES = ['ACTIVE', 'ARCHIVED', 'ALL'] as const;
const ORDER_VALUES = ['asc', 'desc'] as const;

const toPositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
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

  for (const raw of input.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  if (result.length > 20) {
    throw new Error('Documents can have up to 20 tags');
  }

  return result;
};

const readMarkdownFile = (file: string) => {
  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${file}`);
  }
  return readFileSync(filePath, 'utf-8');
};

const titleFromFile = (file: string) => {
  return basename(file).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
};

const safeFileName = (title: string, id: string) => {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  return `${id.slice(0, 8)}-${slug}.md`;
};

const normalizeEnumValue = <T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  label: string,
  options?: { lowercase?: boolean },
): T | undefined => {
  if (value === undefined || value === '') return undefined;
  const normalized = options?.lowercase ? value.toLowerCase() : value.toUpperCase();
  if (!allowedValues.includes(normalized as T)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(', ')}`);
  }
  return normalized as T;
};

const normalizeVisibility = (value?: string) => normalizeEnumValue(value, VISIBILITY_VALUES, '--visibility');
const normalizeArchived = (value?: string) => normalizeEnumValue(value, ARCHIVED_VALUES, '--archived');
const normalizeOrder = (value?: string) => normalizeEnumValue(value, ORDER_VALUES, '--order', { lowercase: true });

const paginationParams = (options: DocumentCommandOptions) => {
  const params: Record<string, string | number> = {};
  const page = toPositiveInteger(options.page);
  const pageSize = toPositiveInteger(options.pageSize ?? options.limit);
  if (page) params.page = page;
  if (pageSize) params.pageSize = pageSize;
  return params;
};

const getCommentContent = (options: DocumentCommandOptions, action: string) => {
  if (options.content !== undefined && options.file) {
    throw new Error(`Use either --content or --file for document ${action}, not both`);
  }
  if (options.content !== undefined) return options.content;
  if (options.file) return readMarkdownFile(options.file);
  throw new Error(`--content or --file is required for document ${action}`);
};

const getDocumentData = (response: unknown) => {
  return (response as { data: DocumentRecord }).data;
};

const withMessage = <T extends Record<string, unknown>>(response: T, message: string): T & { message: string } => {
  return {
    ...response,
    message,
  };
};

export async function executeDocumentCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: DocumentCommandOptions,
) {
  switch (action) {
    case 'create': {
      if (!options.file) throw new Error('--file is required for document create');
      const body = readMarkdownFile(options.file);
      // 에이전트/러너는 확정 태그를 직접 설정하지 않는다. --tags·--suggested-tags 모두 추천(suggestedTags)으로 보낸다.
      // (기존 프로젝트 태그와 일치하는 추천은 서버에서 자동 승격되고, 신규는 사용자 큐레이션 대상이 된다.)
      const createSuggestedTags = normalizeTags([options.suggestedTags, options.tags].filter(Boolean).join(','));
      const response = await createDocument(apiUrl, projectId, headers, {
        title: options.title ?? titleFromFile(options.file),
        body,
        ...(createSuggestedTags.length > 0 ? { suggestedTags: createSuggestedTags } : {}),
        ...(options.visibility ? { visibility: normalizeVisibility(options.visibility) } : {}),
      });
      return withMessage(response as Record<string, unknown>, 'Document created');
    }

    case 'update': {
      if (!options.id) throw new Error('--id is required for document update');
      const payload: Record<string, unknown> = {};
      if (options.title) payload.title = options.title;
      if (options.file) payload.body = readMarkdownFile(options.file);
      // create와 동일: --tags/--suggested-tags는 확정 태그가 아니라 추천으로 보낸다(에이전트는 확정 태그 직접 설정 불가).
      if (options.tags !== undefined || options.suggestedTags !== undefined) {
        payload.suggestedTags = normalizeTags([options.suggestedTags, options.tags].filter(Boolean).join(','));
      }
      if (options.visibility !== undefined) payload.visibility = normalizeVisibility(options.visibility);
      if (Object.keys(payload).length === 0) {
        throw new Error(
          'At least one of --title, --file, --tags, --suggested-tags, or --visibility is required for document update',
        );
      }

      const response = await updateDocument(apiUrl, projectId, headers, options.id, payload);
      return withMessage(response as Record<string, unknown>, 'Document updated');
    }

    case 'download': {
      if (!options.id) throw new Error('--id is required for document download');
      const documentResponse = await getDocument(apiUrl, projectId, headers, options.id);
      const document = getDocumentData(documentResponse);
      const body = await downloadDocumentBody(apiUrl, projectId, headers, options.id);
      const outputDir = resolve(DOCUMENT_DOWNLOAD_DIR);
      mkdirSync(outputDir, { recursive: true });
      const outputPath = join(outputDir, safeFileName(document.title, document.id));
      atomicWriteFileSync(outputPath, body ?? document.body ?? '', 'utf-8');
      return [
        `Document downloaded to ${outputPath}`,
        `id: ${document.id}`,
        `title: ${document.title}`,
        document.webUrl ? `webUrl: ${document.webUrl}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'list': {
      const params: Record<string, string | number> = {};
      if (options.query) params.q = options.query;
      if (options.tags) params.tags = normalizeTags(options.tags).join(',');
      if (options.visibility) params.visibility = normalizeVisibility(options.visibility) ?? '';
      if (options.archived) params.archived = normalizeArchived(options.archived) ?? '';
      Object.assign(params, paginationParams(options));

      const response = await listDocuments(apiUrl, projectId, headers, params);
      const documents = (response as { data: DocumentRecord[] }).data;
      return documents.length === 0 ? withMessage(response as Record<string, unknown>, 'No documents found') : response;
    }

    case 'tags': {
      // 프로젝트의 기존 확정 태그 + 사용 수 집계. 문서 생성 시 reuse-first(기존 태그 재사용)에 활용.
      const params: Record<string, string | number> = {};
      if (options.visibility) params.visibility = normalizeVisibility(options.visibility) ?? '';
      if (options.archived) params.archived = normalizeArchived(options.archived) ?? '';
      const response = await listDocumentTags(apiUrl, projectId, headers, params);
      const tags = (response as { data: unknown[] }).data;
      return tags.length === 0 ? withMessage(response as Record<string, unknown>, 'No tags found') : response;
    }

    case 'delete': {
      if (!options.id) throw new Error('--id is required for document delete');
      await deleteDocument(apiUrl, projectId, headers, options.id);
      return {
        message: 'Document deleted',
        data: {
          id: options.id,
        },
      };
    }

    case 'archive':
    case 'unarchive': {
      if (!options.id) throw new Error(`--id is required for document ${action}`);
      const response =
        action === 'archive'
          ? await archiveDocument(apiUrl, projectId, headers, options.id)
          : await unarchiveDocument(apiUrl, projectId, headers, options.id);
      return withMessage(
        response as Record<string, unknown>,
        action === 'archive' ? 'Document archived' : 'Document unarchived',
      );
    }

    case 'revisions': {
      if (!options.id) throw new Error('--id is required for document revisions');
      const response = await listDocumentRevisions(apiUrl, projectId, headers, options.id, paginationParams(options));
      const revisions = (response as { data: DocumentRevisionRecord[] }).data;
      return revisions.length === 0
        ? withMessage(response as Record<string, unknown>, 'No document revisions found')
        : response;
    }

    case 'revision-get': {
      if (!options.id) throw new Error('--id is required for document revision-get');
      if (!options.revisionId) throw new Error('--revision-id is required for document revision-get');
      const response = await getDocumentRevision(apiUrl, projectId, headers, options.id, options.revisionId);
      return withMessage(response as Record<string, unknown>, 'Document revision');
    }

    case 'revision-restore': {
      if (!options.id) throw new Error('--id is required for document revision-restore');
      if (!options.revisionId) throw new Error('--revision-id is required for document revision-restore');
      const response = await restoreDocumentRevision(apiUrl, projectId, headers, options.id, options.revisionId);
      return withMessage(response as Record<string, unknown>, 'Document revision restored');
    }

    case 'comment-list': {
      if (!options.id) throw new Error('--id is required for document comment-list');
      const params = paginationParams(options);
      if (options.order) params.order = normalizeOrder(options.order) ?? '';
      const response = await listDocumentComments(apiUrl, projectId, headers, options.id, params);
      const comments = (response as { data: DocumentCommentRecord[] }).data;
      return comments.length === 0
        ? withMessage(response as Record<string, unknown>, 'No document comments found')
        : response;
    }

    case 'comment-create': {
      if (!options.id) throw new Error('--id is required for document comment-create');
      const response = await createDocumentComment(apiUrl, projectId, headers, options.id, {
        content: getCommentContent(options, action),
      });
      return withMessage(response as Record<string, unknown>, 'Document comment created');
    }

    case 'comment-update': {
      if (!options.id) throw new Error('--id is required for document comment-update');
      if (!options.commentId) throw new Error('--comment-id is required for document comment-update');
      const response = await updateDocumentComment(apiUrl, projectId, headers, options.id, options.commentId, {
        content: getCommentContent(options, action),
      });
      return withMessage(response as Record<string, unknown>, 'Document comment updated');
    }

    case 'comment-delete': {
      if (!options.id) throw new Error('--id is required for document comment-delete');
      if (!options.commentId) throw new Error('--comment-id is required for document comment-delete');
      await deleteDocumentComment(apiUrl, projectId, headers, options.id, options.commentId);
      return {
        message: 'Document comment deleted',
        data: {
          documentId: options.id,
          commentId: options.commentId,
        },
      };
    }

    default:
      throw new Error(
        'Unknown document action: ' +
          `${action}. Use create, update, download, list, delete, archive, unarchive, revisions, ` +
          'revision-get, revision-restore, comment-list, comment-create, comment-update, or comment-delete.',
      );
  }
}
