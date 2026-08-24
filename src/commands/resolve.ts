import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { parseEntityRef, type EntityRefKind, type ParsedEntityRef } from '../utils/entityRef.js';
import { findProjectConfig } from '../utils/config.js';
import { getConvention } from '../api/convention.js';
import { downloadSkill } from '../api/skill.js';
import { getCodeReview, getCodeReviewFinding } from '../api/codeReview.js';
import { getPlanTask } from '../api/task.js';
import { getLinearIssue } from '../api/linear.js';
import { getSentryIssue } from '../api/sentry.js';
import { executePlanCommand } from './plan.js';
import { executeReportCommand } from './report.js';
import { executePostMortemCommand } from './postmortem.js';
import { executeCoActionCommand } from './coaction.js';
import { downloadDocumentToFile } from './document.js';

export interface ResolveApiContext {
  apiUrl: string;
  projectId: string;
  headers: Record<string, string>;
}

/**
 * Standard `resolve` envelope. `kind` tells the caller what to do next:
 * read `filePath`, use `record`, or open `url` / run `suggestedCommand`.
 */
export interface ResolveResult {
  message: string;
  kind: EntityRefKind;
  refType: string;
  id: string;
  parentId?: string;
  filePath?: string;
  url?: string;
  suggestedCommand?: string;
  fallbackCommand: string;
  record?: unknown;
}

/** Local paths in a `convention:id:path` reference are project-root relative. */
function findProjectRoot(): string | null {
  const configPath = findProjectConfig(process.cwd());
  if (!configPath) return null;
  return resolvePath(dirname(configPath), '..');
}

/**
 * Conventions are only ever deployed under `.agentteams/`, so that subtree is
 * the containment boundary for a reference-carried path. A reference comes from
 * user-authored text, and this command turns it into a machine-readable "read
 * this file" instruction — without the boundary a crafted path would nominate
 * any file on the machine.
 */
const CONVENTION_PATH_ROOT = '.agentteams';

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Every `filePath` in the envelope is absolute, so cwd never changes its meaning. */
function toAbsoluteFilePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolvePath(findProjectRoot() ?? process.cwd(), filePath);
}

function toFilePath(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const filePath = (result as Record<string, unknown>).filePath;
    if (typeof filePath === 'string' && filePath.length > 0) return filePath;
  }
  return undefined;
}

/**
 * Body-bearing entities reuse the existing `download` actions verbatim, so the
 * file naming, frontmatter, and output directory stay defined in one place.
 */
async function resolveFile(parsed: ParsedEntityRef, context: ResolveApiContext): Promise<string | undefined> {
  const { apiUrl, projectId, headers } = context;
  const id = parsed.id;

  switch (parsed.refType) {
    case 'plan':
      return toFilePath(await executePlanCommand(apiUrl, projectId, headers, 'download', { id }));
    case 'completionReport':
      return toFilePath(await executeReportCommand(apiUrl, headers, 'download', { id, projectId }));
    case 'postMortem':
      return toFilePath(await executePostMortemCommand(apiUrl, headers, 'download', { id, projectId }));
    case 'coAction':
      return toFilePath(await executeCoActionCommand(apiUrl, headers, 'download', { id, projectId }));
    case 'document':
      return (await downloadDocumentToFile(apiUrl, projectId, headers, id)).filePath;
    default:
      throw new Error(`No download path for reference type: ${parsed.refType}`);
  }
}

async function resolveRecord(parsed: ParsedEntityRef, context: ResolveApiContext): Promise<unknown> {
  const { apiUrl, projectId, headers } = context;

  switch (parsed.refType) {
    case 'codeReview':
      return getCodeReview(apiUrl, projectId, headers, parsed.id);
    case 'codeReviewFinding':
      return getCodeReviewFinding(apiUrl, projectId, headers, parsed.id, parsed.parentId);
    case 'planTask':
      return getPlanTask(apiUrl, projectId, headers, parsed.id, parsed.parentId);
    case 'convention':
      return getConvention(apiUrl, projectId, headers, parsed.id);
    case 'skill':
      return downloadSkill(apiUrl, projectId, headers, parsed.id);
    case 'LINEAR_ISSUE':
      return getLinearIssue(apiUrl, headers, parsed.id, projectId);
    // 서버가 프로젝트 바인딩을 검증하고 저장된 permalink를 함께 돌려준다. 토큰의 숫자 ID만으로는
    // permalink를 만들 수 없으므로, 이 경로가 곧 "링크를 지어내지 않는" 보장이다.
    case 'SENTRY_ISSUE':
      return getSentryIssue(apiUrl, projectId, headers, parsed.id);
    default:
      throw new Error(`No record lookup for reference type: ${parsed.refType}`);
  }
}

/**
 * A convention reference carries the local path it was deployed to, so the
 * cheapest resolution is "read that file". A path that is missing, escapes the
 * project's `.agentteams/` subtree, or is absolute and points elsewhere yields
 * null, which degrades to the server record instead of failing.
 */
function resolveLocalPath(parsed: ParsedEntityRef): string | null {
  const path = parsed.path;
  if (!path) return null;

  const projectRoot = findProjectRoot() ?? process.cwd();
  const conventionRoot = join(projectRoot, CONVENTION_PATH_ROOT);
  const candidates = isAbsolute(path) ? [resolvePath(path)] : [resolvePath(projectRoot, path), resolvePath(path)];
  return candidates.find((candidate) => isInside(conventionRoot, candidate) && existsSync(candidate)) ?? null;
}

/**
 * Resolve one `[label](type:id[:path])` entity reference.
 *
 * `loadContext` is lazy on purpose: external markers and local convention
 * paths resolve without any project configuration or network access.
 */
export async function executeResolveCommand(
  options: Record<string, unknown>,
  loadContext: () => Promise<ResolveApiContext>,
): Promise<ResolveResult> {
  const ref = typeof options.ref === 'string' ? options.ref : '';
  if (ref.trim().length === 0) {
    throw new Error('A reference is required: agentteams resolve "<type>:<id>"');
  }

  const parsed = parseEntityRef(ref);
  const base = {
    refType: parsed.refType,
    id: parsed.id,
    fallbackCommand: parsed.fallbackCommand,
    ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
  };

  if (parsed.kind === 'external') {
    return {
      ...base,
      kind: 'external',
      message: parsed.suggestedCommand
        ? `${parsed.refType} reference — fetch it with: ${parsed.suggestedCommand}`
        : `${parsed.refType} reference — open the URL directly`,
      ...(parsed.url ? { url: parsed.url } : {}),
      ...(parsed.suggestedCommand ? { suggestedCommand: parsed.suggestedCommand } : {}),
    };
  }

  if (parsed.kind === 'localFile') {
    const localPath = resolveLocalPath(parsed);
    if (localPath) {
      return {
        ...base,
        kind: 'localFile',
        message: `Read the local file: ${localPath}`,
        filePath: localPath,
      };
    }
    // Missing locally → fall through to the server copy of the convention.
    const record = await resolveRecord(parsed, await loadContext());
    return {
      ...base,
      kind: 'record',
      message: `Local path not found under ${CONVENTION_PATH_ROOT}/ (${parsed.path}); returning the server record instead`,
      record,
    };
  }

  const context = await loadContext();

  if (parsed.kind === 'file') {
    const downloaded = await resolveFile(parsed, context);
    const filePath = downloaded ? toAbsoluteFilePath(downloaded) : undefined;
    return {
      ...base,
      kind: 'file',
      message: filePath ? `Read the downloaded file: ${filePath}` : `${parsed.refType} downloaded`,
      ...(filePath ? { filePath } : {}),
    };
  }

  const record = await resolveRecord(parsed, context);
  return {
    ...base,
    kind: 'record',
    // 다른 kind와 마찬가지로 서술이 아니라 지시여야 한다 — 호출부가 `kind`별 규칙을 따로 갖지
    // 않고 이 문장만 따르면 되도록.
    message: `${parsed.refType} resolved — use the inline \`record\` payload`,
    record,
  };
}
