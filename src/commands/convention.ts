import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { atomicWriteFileSync } from '../utils/atomicWrite.js';
import { basename, join, relative, resolve, sep } from 'node:path';
import httpClient from '../utils/httpClient.js';
import { isAxiosError } from 'axios';
import { downloadAllConventions, listConventions } from '../api/convention.js';
import matter from 'gray-matter';
import { diffLines, createTwoFilesPatch } from 'diff';
import { loadConfigWithCredential, findProjectConfig, getConfigurationNotFoundMessage } from '../utils/config.js';
import { withSpinner } from '../utils/spinner.js';
import { withoutJsonContentType } from '../utils/httpHeaders.js';
import { compareVersions, getLatestCliVersion } from '../utils/updateCheck.js';
import type { Config } from '../types/index.js';
import { buildAuthHeaders } from '../utils/apiContext.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const CONVENTION_DIR = '.agentteams';
const LEGACY_CONVENTION_DOWNLOAD_DIR = 'conventions';
const CONVENTION_INDEX_FILE = 'convention.md';
const CONVENTION_MANIFEST_FILE = 'conventions.manifest.json';

type ConventionCommandOptions = {
  cwd?: string;
  config?: Config;
  currentCliVersion?: string;
  latestCliVersion?: string | null;
  // 컨벤션 템플릿을 조회할 AgentConfig. 호출부(`init`)가 방금 연결한 에이전트를 알고 있을 때만
  // 전달한다. 값이 있으면 목록 조회를 건너뛴다(아래 downloadReportingTemplate 참조).
  agentConfigId?: string;
};

type ConventionDownloadManifestV1 = {
  version: 1;
  generatedAt: string;
  platformGuidesHash?: string;
  // 가이드 파일명 → 해시. 선택 필드이므로 이 키가 없는 구버전 manifest는 "알 수 없음"으로 취급한다.
  // (집계 해시만 쓰면 다른 가이드 변경만으로도 문서 쓰기가 GUIDE_OUTDATED로 오탐된다.)
  platformGuideHashes?: Record<string, string>;
  entries: Array<{
    conventionId: string;
    fileRelativePath: string;
    fileName: string;
    categoryDir: string;
    title?: string;
    category?: string;
    scope?: string;
    updatedAt?: string;
    downloadedAt: string;
    lastUploadedAt?: string;
    lastKnownUpdatedAt?: string;
  }>;
};

type ConventionUploadOptions = ConventionCommandOptions & {
  file: string | string[];
  apply?: boolean;
};

type ConventionDeleteOptions = ConventionCommandOptions & {
  file: string | string[];
  apply?: boolean;
};

type ConventionCreateOptions = ConventionCommandOptions & {
  file: string | string[];
  scope?: string;
};

type ConventionListItem = {
  id: string;
  title?: string;
  category?: string;
  fileName?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

type ConventionDownloadItem = ConventionListItem & {
  contentMarkdown?: string;
  scope?: string;
};

type ConventionManifestEntry = ConventionDownloadManifestV1['entries'][number];

export type ConventionFreshnessChange = {
  id: string;
  type: 'new' | 'updated' | 'deleted';
  title?: string;
  fileName?: string;
};

export type ConventionFreshnessResult = {
  platformGuidesChanged: boolean;
  conventionChanges: ConventionFreshnessChange[];
};

type PlatformGuide = {
  title?: string;
  fileName?: string;
  category?: string;
  content?: string;
  // 가이드 1건의 해시. 쓰기 계약(guideHash)의 값이며 구버전 서버에는 없다.
  hash?: string;
};

function findProjectRoot(cwd?: string): string | null {
  const configPath = findProjectConfig(cwd ?? process.cwd());
  if (!configPath) return null;
  // configPath = /path/.agentteams/config.json → resolve up 2 levels to project root
  return resolve(configPath, '..', '..');
}

function getApiBaseUrl(apiUrl: string): string {
  return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
}

async function getApiConfigOrThrow(options?: ConventionCommandOptions) {
  // Credential-aware: a personal-token project keeps no `apiKey` on disk, and
  // the conventions these commands sync become always-on agent rules — reading
  // "not initialized" there would silently freeze a project's rules.
  const config = options?.config ?? (await loadConfigWithCredential());
  if (!config) {
    throw new Error(getConfigurationNotFoundMessage(options?.cwd));
  }

  return {
    config,
    apiUrl: getApiBaseUrl(config.apiUrl),
    headers: {
      ...buildAuthHeaders(config.apiKey),
      'Content-Type': 'application/json',
    },
  };
}

function normalizeRelativePath(input: string): string {
  return input.replaceAll('\\', '/');
}

function resolveConventionFileAbsolutePath(projectRoot: string, cwd: string, fileInput: string): string {
  // If absolute path, keep as-is.
  const resolvedFromCwd = resolve(cwd, fileInput);
  if (resolvedFromCwd === fileInput && existsSync(fileInput)) {
    return validatePathBoundary(fileInput, projectRoot);
  }

  // Common usage: pass `.agentteams/...` from any working directory.
  if (fileInput.startsWith(`${CONVENTION_DIR}/`) || fileInput.startsWith(`${CONVENTION_DIR}\\`)) {
    return validatePathBoundary(resolve(projectRoot, fileInput), projectRoot);
  }

  // Fallback: if the cwd-based resolution exists, use it.
  if (existsSync(resolvedFromCwd)) {
    return validatePathBoundary(resolvedFromCwd, projectRoot);
  }

  // Otherwise, return cwd-based resolution to preserve a stable error path.
  return validatePathBoundary(resolvedFromCwd, projectRoot);
}

function validatePathBoundary(absolutePath: string, projectRoot: string): string {
  const normalized = resolve(absolutePath);
  if (!normalized.startsWith(resolve(projectRoot) + sep)) {
    throw new Error('Path traversal detected: file must be within project root');
  }
  return normalized;
}

function buildManifestPath(projectRoot: string): string {
  return join(projectRoot, CONVENTION_DIR, CONVENTION_MANIFEST_FILE);
}

function loadManifestOrThrow(projectRoot: string): ConventionDownloadManifestV1 {
  const manifestPath = buildManifestPath(projectRoot);
  if (!existsSync(manifestPath)) {
    throw new Error(`Download manifest not found: ${manifestPath}\nRun 'agentteams convention download' first.`);
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as ConventionDownloadManifestV1;
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid manifest format: ${manifestPath}`);
  }
  return parsed;
}

function loadManifestOrCreate(projectRoot: string): ConventionDownloadManifestV1 {
  const manifestPath = buildManifestPath(projectRoot);
  if (!existsSync(manifestPath)) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: [],
    };
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as ConventionDownloadManifestV1;
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid manifest format: ${manifestPath}`);
  }
  return parsed;
}

function writeManifest(projectRoot: string, manifest: ConventionDownloadManifestV1) {
  const manifestPath = buildManifestPath(projectRoot);
  atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function toFileList(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}

function hasAnyDiff(a: string, b: string): boolean {
  const parts = diffLines(a, b);
  return parts.some((p) => p.added || p.removed);
}

function createUnifiedDiff(fileLabel: string, serverText: string, localText: string): string {
  return createTwoFilesPatch(`${fileLabel} (server)`, `${fileLabel} (local)`, serverText, localText, '', '', {
    context: 3,
  });
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fileNameToTitle(fileName: string): string {
  return fileName.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCategoryFromAgentteamsPath(fileRelativePath: string): string {
  const normalized = normalizeRelativePath(fileRelativePath);
  const parts = normalized.split('/');

  const agentteamsIndex = parts.indexOf(CONVENTION_DIR);
  if (agentteamsIndex === -1) {
    throw new Error(`Convention create requires a file under ${CONVENTION_DIR}/<category>/: ${fileRelativePath}`);
  }

  const category = parts[agentteamsIndex + 1];
  if (!category || category.length === 0) {
    throw new Error(`Convention create requires a category directory under ${CONVENTION_DIR}/: ${fileRelativePath}`);
  }

  if (category === 'platform' || category === 'active-plan') {
    throw new Error(`Convention create does not allow reserved directories under ${CONVENTION_DIR}/: ${category}`);
  }

  return category;
}

async function fetchAllConventions(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
): Promise<ConventionListItem[]> {
  const pageSize = 100;
  let page = 1;
  let totalPages: number | undefined;
  const items: ConventionListItem[] = [];

  while (true) {
    const envelope = await listConventions(apiUrl, projectId, headers, { page, pageSize });

    const data = envelope?.data;
    if (!Array.isArray(data)) {
      break;
    }

    items.push(...data);

    const meta = envelope?.meta;
    if (typeof meta?.totalPages === 'number') {
      totalPages = meta.totalPages;
    }

    if (totalPages !== undefined) {
      if (page >= totalPages) break;
      page += 1;
      continue;
    }

    // Fallback if meta is missing: stop when we got less than a full page.
    if (data.length < pageSize) break;
    page += 1;
  }

  return items;
}

async function fetchConventionsWithContent(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
): Promise<ConventionDownloadItem[]> {
  const envelope = await downloadAllConventions(apiUrl, projectId, headers);

  const data = envelope?.data;
  if (!Array.isArray(data)) {
    throw new Error('Invalid download-all response format');
  }

  return data;
}

async function fetchPlatformGuidesHash(apiUrl: string, headers: Record<string, string>): Promise<string> {
  const response = await httpClient.get(`${apiUrl}/api/platform/guides/hash`, { headers });

  const hash = response.data?.data?.hash;
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('Invalid platform guides hash response format');
  }

  return hash;
}

/**
 * 다운로드 경로 전용: 이 엔드포인트가 없는 구버전 서버(404)면 "해시 없음"으로 계속한다.
 * 그 외 실패는 그대로 던진다 — 조용히 넘기면 파일과 해시가 어긋난 manifest가 남는다.
 */
async function fetchPlatformGuidesHashIfAvailable(
  apiUrl: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  try {
    return await fetchPlatformGuidesHash(apiUrl, headers);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return undefined;
    }
    throw error;
  }
}

function toConventionName(convention: { title?: string; fileName?: string | null; id: string }): string {
  const title = typeof convention.title === 'string' ? convention.title.trim() : '';
  if (title.length > 0) return title;
  const fileName = typeof convention.fileName === 'string' ? convention.fileName.trim() : '';
  if (fileName.length > 0) return fileName;
  return convention.id;
}

function toConventionNameFromManifest(entry: ConventionManifestEntry): string {
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (title.length > 0) return title;
  const fileName = typeof entry.fileName === 'string' ? entry.fileName.trim() : '';
  if (fileName.length > 0) return fileName;
  return entry.conventionId;
}

function toOptionalStringOrNullIfPresent(data: Record<string, unknown>, key: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    return undefined;
  }
  const value = data[key];
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
}

export async function conventionShow(): Promise<any> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow();

  const conventions = await fetchConventionsWithContent(apiUrl, config.projectId, headers);
  if (!conventions || conventions.length === 0) {
    throw new Error('No conventions found for this project. Create one via the web dashboard first.');
  }

  const sections: string[] = [];
  for (const convention of conventions) {
    const contentMarkdown = typeof convention.contentMarkdown === 'string' ? convention.contentMarkdown : '';

    const sectionHeader = `# ${convention.title ?? 'untitled'}\ncategory: ${convention.category ?? 'uncategorized'}\nid: ${convention.id}`;
    sections.push(`${sectionHeader}\n\n${contentMarkdown}`);
  }

  return sections.join('\n\n---\n\n');
}

export async function checkConventionFreshness(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  projectRoot: string,
): Promise<ConventionFreshnessResult> {
  const manifestPath = buildManifestPath(projectRoot);
  if (!existsSync(manifestPath)) {
    return {
      platformGuidesChanged: false,
      conventionChanges: [],
    };
  }

  const manifest = loadManifestOrThrow(projectRoot);
  const currentPlatformGuidesHash = await fetchPlatformGuidesHash(apiUrl, headers);
  const platformGuidesChanged =
    typeof manifest.platformGuidesHash === 'string' &&
    manifest.platformGuidesHash.length > 0 &&
    manifest.platformGuidesHash !== currentPlatformGuidesHash;

  const serverConventions = await fetchAllConventions(apiUrl, projectId, headers);
  const serverById = new Map(serverConventions.map((item) => [item.id, item]));
  const localById = new Map(manifest.entries.map((entry) => [entry.conventionId, entry]));
  const conventionChanges: ConventionFreshnessChange[] = [];

  for (const serverConvention of serverConventions) {
    const local = localById.get(serverConvention.id);
    if (!local) {
      conventionChanges.push({
        id: serverConvention.id,
        type: 'new',
        title: toConventionName(serverConvention),
        fileName: serverConvention.fileName ?? undefined,
      });
      continue;
    }

    if (
      typeof serverConvention.updatedAt === 'string' &&
      typeof local.updatedAt === 'string' &&
      serverConvention.updatedAt !== local.updatedAt
    ) {
      conventionChanges.push({
        id: serverConvention.id,
        type: 'updated',
        title: toConventionName(serverConvention),
        fileName: serverConvention.fileName ?? local.fileName,
      });
    }
  }

  for (const localEntry of manifest.entries) {
    if (serverById.has(localEntry.conventionId)) continue;
    conventionChanges.push({
      id: localEntry.conventionId,
      type: 'deleted',
      title: toConventionNameFromManifest(localEntry),
      fileName: localEntry.fileName,
    });
  }

  return {
    platformGuidesChanged,
    conventionChanges,
  };
}

export type ConventionStatusResult = {
  /** True when the local conventions are behind the server (any change or platform-guide drift). */
  updateAvailable: boolean;
  /** Explicit alias for updateAvailable; CLI updates are reported separately. */
  conventionUpdateAvailable: boolean;
  platformGuidesChanged: boolean;
  conventionChanges: ConventionFreshnessChange[];
  cliUpdateAvailable: boolean;
  currentCliVersion: string;
  latestCliVersion: string | null;
  /** True when either conventions or the CLI need action. */
  actionRequired: boolean;
  actions: {
    updateCli: string | null;
    syncConventions: string | null;
  };
  /** Strong, machine-readable next-step hints for agents and humans. */
  hints: string[];
  /** One-line human-readable summary. */
  summary: string;
  /**
   * Set when the project *is* configured but its credential could not be
   * resolved. Distinguishes "nothing to check" from "could not check" — the
   * latter must never read as "up to date".
   */
  credentialProblem?: string;
};

export function buildStatusSummary(result: ConventionFreshnessResult): string {
  const parts: string[] = [];
  if (result.platformGuidesChanged) parts.push('platform guides');
  const counts = { new: 0, updated: 0, deleted: 0 } as Record<ConventionFreshnessChange['type'], number>;
  for (const change of result.conventionChanges) counts[change.type] += 1;
  if (counts.new > 0) parts.push(`${counts.new} new`);
  if (counts.updated > 0) parts.push(`${counts.updated} updated`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} deleted`);

  if (parts.length === 0) return '✓ Conventions/platform guides up to date';
  return `ACTION REQUIRED: Convention updates available (${parts.join(', ')}). Run 'agentteams convention download' now, then re-read .agentteams/convention.md and changed rule files.`;
}

function buildCliSummary(
  currentCliVersion: string,
  latestCliVersion: string | null,
  cliUpdateAvailable: boolean,
): string {
  if (cliUpdateAvailable && latestCliVersion) {
    return `ACTION REQUIRED: AgentTeams CLI update available (${currentCliVersion} → ${latestCliVersion}). Run 'npm install -g @agentteams/cli' before continuing.`;
  }

  if (!latestCliVersion) {
    return `⚠ AgentTeams CLI latest-version check unavailable. Current CLI: ${currentCliVersion}. Run 'npm view @agentteams/cli version' to verify manually.`;
  }

  return `✓ AgentTeams CLI up to date (${currentCliVersion})`;
}

function buildCombinedStatusSummary(params: {
  conventionSummary: string;
  cliSummary: string;
  conventionUpdateAvailable: boolean;
  cliUpdateAvailable: boolean;
}): string {
  if (params.conventionUpdateAvailable || params.cliUpdateAvailable) {
    return [params.cliSummary, params.conventionSummary].join(' ');
  }

  return `${params.cliSummary}; ${params.conventionSummary}`;
}

async function resolveCliUpdateStatus(options?: ConventionCommandOptions): Promise<{
  currentCliVersion: string;
  latestCliVersion: string | null;
  cliUpdateAvailable: boolean;
}> {
  const currentCliVersion = options?.currentCliVersion ?? pkg.version;
  const latestCliVersion =
    options && 'latestCliVersion' in options ? (options.latestCliVersion ?? null) : await getLatestCliVersion();
  const cliUpdateAvailable = latestCliVersion ? compareVersions(currentCliVersion, latestCliVersion) : false;
  return { currentCliVersion, latestCliVersion, cliUpdateAvailable };
}

function buildStatusResult(params: {
  freshness: ConventionFreshnessResult;
  currentCliVersion: string;
  latestCliVersion: string | null;
  cliUpdateAvailable: boolean;
  credentialProblem?: string;
}): ConventionStatusResult {
  const conventionUpdateAvailable =
    params.freshness.platformGuidesChanged || params.freshness.conventionChanges.length > 0;
  const conventionSummary = buildStatusSummary(params.freshness);
  const cliSummary = buildCliSummary(params.currentCliVersion, params.latestCliVersion, params.cliUpdateAvailable);
  const actions = {
    updateCli: params.cliUpdateAvailable ? 'npm install -g @agentteams/cli' : null,
    syncConventions: conventionUpdateAvailable ? 'agentteams convention download' : null,
  };
  const hints: string[] = [];

  if (params.cliUpdateAvailable && params.latestCliVersion) {
    hints.push(
      `ACTION REQUIRED: Update AgentTeams CLI first: ${actions.updateCli} (current ${params.currentCliVersion}, latest ${params.latestCliVersion}).`,
    );
  } else if (!params.latestCliVersion) {
    hints.push(
      `WARNING: CLI latest-version check was unavailable. Current CLI is ${params.currentCliVersion}; verify with 'npm view @agentteams/cli version' if freshness matters.`,
    );
  } else {
    hints.push(`OK: AgentTeams CLI is up to date (${params.currentCliVersion}).`);
  }

  if (conventionUpdateAvailable) {
    hints.push(
      `ACTION REQUIRED: Sync conventions now: ${actions.syncConventions}. After syncing, re-read .agentteams/convention.md and any changed rule files before continuing.`,
    );
  } else if (params.credentialProblem) {
    hints.push(
      `WARNING: Convention freshness was NOT checked — ${params.credentialProblem} Conventions may be stale; fix the login, then re-run 'agentteams convention status'.`,
    );
  } else {
    hints.push('OK: Conventions and platform guides are up to date.');
  }

  return {
    ...(params.credentialProblem ? { credentialProblem: params.credentialProblem } : {}),
    updateAvailable: conventionUpdateAvailable,
    conventionUpdateAvailable,
    platformGuidesChanged: params.freshness.platformGuidesChanged,
    conventionChanges: params.freshness.conventionChanges,
    cliUpdateAvailable: params.cliUpdateAvailable,
    currentCliVersion: params.currentCliVersion,
    latestCliVersion: params.latestCliVersion,
    actionRequired: conventionUpdateAvailable || params.cliUpdateAvailable || Boolean(params.credentialProblem),
    actions,
    hints,
    summary: buildCombinedStatusSummary({
      conventionSummary,
      cliSummary,
      conventionUpdateAvailable,
      cliUpdateAvailable: params.cliUpdateAvailable,
    }),
  };
}

/**
 * Read-only freshness check exposed as `agentteams convention status`.
 *
 * Compares the local download manifest against the server and reports whether an
 * update is available — it never downloads or mutates anything. Degrades gracefully
 * (exit 0, updateAvailable=false) when the project is not configured or has no local
 * conventions yet, so callers can safely "check then skip when unavailable".
 *
 * "Not configured" and "configured but the credential failed" are reported
 * differently on purpose. The platform convention makes this the session-start
 * freshness gate, so a project whose login is broken must say so instead of
 * quietly claiming its rules are current.
 */
export async function conventionStatus(options?: ConventionCommandOptions): Promise<ConventionStatusResult> {
  const projectRoot = findProjectRoot(options?.cwd);
  const cliStatus = await resolveCliUpdateStatus(options);

  let config = options?.config ?? null;
  let credentialProblem: string | undefined;
  if (!config) {
    try {
      config = await loadConfigWithCredential();
    } catch (error) {
      credentialProblem = error instanceof Error ? error.message : String(error);
    }
  }

  // Not configured or no local conventions → nothing to compare; treat as up to date.
  if (!config || !projectRoot) {
    return buildStatusResult({
      freshness: { platformGuidesChanged: false, conventionChanges: [] },
      ...cliStatus,
      // Only a project that exists locally can have a credential problem worth
      // reporting; without a project root there is nothing to be stale.
      ...(credentialProblem && projectRoot ? { credentialProblem } : {}),
    });
  }

  const apiUrl = getApiBaseUrl(config.apiUrl);
  const headers = {
    ...buildAuthHeaders(config.apiKey),
    'Content-Type': 'application/json',
  };

  const freshness = await checkConventionFreshness(apiUrl, config.projectId, headers, projectRoot);
  return buildStatusResult({ freshness, ...cliStatus });
}

export async function conventionList(): Promise<any> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow();

  const conventions = await fetchAllConventions(apiUrl, config.projectId, headers);
  if (!Array.isArray(conventions)) {
    return { data: conventions };
  }

  return {
    data: conventions.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      fileName: item.fileName,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
    })),
    meta: {
      total: conventions.length,
      page: 1,
      pageSize: conventions.length,
      totalPages: 1,
    },
  };
}

function toSafeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toSafeDirectoryName(input: string): string {
  const normalized = toSafeFileName(input);
  return normalized.length > 0 ? normalized : 'uncategorized';
}

function buildConventionFileName(convention: { id: string; title?: string; fileName?: string | null }): string {
  if (convention.fileName && convention.fileName.trim().length > 0) {
    return convention.fileName.trim();
  }
  const titleSegment = convention.title ? toSafeFileName(convention.title) : '';
  const prefix = titleSegment.length > 0 ? titleSegment : 'convention';
  return `${prefix}.md`;
}

function normalizeMarkdownFileName(input: string): string {
  const trimmed = input.trim();
  const base = trimmed.toLowerCase().endsWith('.md') ? trimmed.slice(0, -3) : trimmed;

  const safeBase = toSafeFileName(base);
  const resolvedBase = safeBase.length > 0 ? safeBase : 'guide';
  return `${resolvedBase}.md`;
}

function buildPlatformGuideFileName(guide: PlatformGuide): string {
  if (typeof guide.fileName === 'string' && guide.fileName.trim().length > 0) {
    return normalizeMarkdownFileName(guide.fileName);
  }

  if (typeof guide.title === 'string' && guide.title.trim().length > 0) {
    return `${toSafeFileName(guide.title)}.md`;
  }

  return 'guide.md';
}

type PlatformGuideDownloadResult = {
  written: number;
  // 로컬에 쓴 파일명 → 서버가 내려준 가이드별 해시. 쓰기 계약의 guideHash가 이 값을 그대로 쓴다.
  // 서버가 hash를 아직 안 내려주는 구버전이면 빈 맵이고, 그 경우 manifest에도 아무것도 남기지 않아
  // 로더가 "알 수 없음"으로 판정하고 재동기화를 유도한다.
  hashes: Record<string, string>;
};

async function downloadPlatformGuides(
  projectRoot: string,
  apiUrl: string,
  headers: Record<string, string>,
): Promise<PlatformGuideDownloadResult> {
  try {
    const response = await httpClient.get(`${apiUrl}/api/platform/guides`, { headers });

    const guides = response.data?.data;
    if (!Array.isArray(guides) || guides.length === 0) {
      return { written: 0, hashes: {} };
    }

    const baseDir = join(projectRoot, CONVENTION_DIR, 'platform');
    rmSync(baseDir, { recursive: true, force: true });
    mkdirSync(baseDir, { recursive: true });

    const fileNameCount = new Map<string, number>();
    const hashes: Record<string, string> = {};
    let written = 0;

    for (const guide of guides as PlatformGuide[]) {
      if (!guide || typeof guide.content !== 'string') {
        continue;
      }

      const baseFileName = buildPlatformGuideFileName(guide);
      const seenCount = fileNameCount.get(baseFileName) ?? 0;
      fileNameCount.set(baseFileName, seenCount + 1);

      const fileName = seenCount === 0 ? baseFileName : baseFileName.replace(/\.md$/, `-${seenCount + 1}.md`);

      const filePath = join(baseDir, fileName);
      atomicWriteFileSync(filePath, guide.content, 'utf-8');
      if (typeof guide.hash === 'string' && guide.hash.trim().length > 0) {
        hashes[fileName] = guide.hash.trim();
      }
      written += 1;
    }

    return { written, hashes };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return { written: 0, hashes: {} };
    }

    throw error;
  }
}

/**
 * 이번 다운로드의 플랫폼 가이드 해시를 manifest에 보존한다.
 *
 * 컨벤션 다운로드 블록은 프로젝트 컨벤션이 하나도 없으면 manifest를 쓰지 않고 빠져나가므로,
 * 그 경로에서도 해시가 남도록 별도로 load-or-create 해서 병합한다.
 *
 * 두 해시를 **항상 함께** 기록한다. 집계 해시(`platformGuidesHash`)가 비면
 * `checkConventionFreshness`가 가이드 변경을 영원히 감지하지 못하고(문자열일 때만 비교한다),
 * 가이드별 해시(`platformGuideHashes`)가 낡으면 방금 덮어쓴 본문과 짝이 맞지 않는 해시를
 * `guideHash`로 보내 원인 파악이 어려운 GUIDE_OUTDATED가 난다.
 * 그래서 해시를 못 받은 경우(구버전 서버)는 조기 반환이 아니라 키 삭제로 처리한다 —
 * 파일 내용과 해시는 언제나 같은 다운로드에서 나와야 한다.
 */
function persistPlatformGuideHashes(
  projectRoot: string,
  hashes: Record<string, string>,
  platformGuidesHash: string | undefined,
): void {
  const manifest = loadManifestOrCreate(projectRoot);

  if (platformGuidesHash) {
    manifest.platformGuidesHash = platformGuidesHash;
  } else {
    delete manifest.platformGuidesHash;
  }

  if (Object.keys(hashes).length > 0) {
    manifest.platformGuideHashes = hashes;
  } else {
    delete manifest.platformGuideHashes;
  }

  writeManifest(projectRoot, manifest);
}

/**
 * 컨벤션 템플릿(`.agentteams/convention.md`)을 한 번 내려받아 덮어쓴다.
 *
 * `agentConfigId`를 아는 호출부(`init`)는 그 값을 넘겨 목록 조회를 통째로 건너뛴다.
 */
/**
 * 어떤 에이전트를 쓸지 모를 때의 폴백: 프로젝트의 첫 AgentConfig를 고른다.
 *
 * `agentteams convention download`를 직접 실행하는 사용자에게는 고를 근거가 없어서 남겨둔 경로다.
 * 오늘의 서버 응답이 config에 의존하지 않기 때문에(`api/src/routes/agent-configs/index.ts`의
 * `/convention` 핸들러는 404 판정에만 config를 쓰고 본문은 프로젝트 컨벤션만으로 만든다)
 * 아무 config나 골라도 결과가 같다. 그 가정이 깨지는 순간 이 폴백은 **조용히** 틀린 템플릿을
 * 쓰게 되므로, 응답이 config에 의존하게 되면 이 함수부터 다시 봐야 한다.
 */
async function resolveFallbackAgentConfigId(
  config: Config,
  apiUrl: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const agentConfigResponse = await httpClient.get(`${apiUrl}/api/projects/${config.projectId}/agent-configs`, {
    headers,
  });

  const agentConfigs = agentConfigResponse.data?.data;
  if (!Array.isArray(agentConfigs) || agentConfigs.length === 0) {
    return null;
  }

  const firstAgentConfig = agentConfigs[0];
  if (!firstAgentConfig?.id || typeof firstAgentConfig.id !== 'string') {
    return null;
  }

  return firstAgentConfig.id;
}

async function downloadReportingTemplate(
  projectRoot: string,
  config: Config,
  apiUrl: string,
  headers: Record<string, string>,
  agentConfigId?: string,
): Promise<boolean> {
  const resolvedAgentConfigId = agentConfigId ?? (await resolveFallbackAgentConfigId(config, apiUrl, headers));
  if (!resolvedAgentConfigId) {
    return false;
  }

  const templateResponse = await httpClient.get(
    `${apiUrl}/api/projects/${config.projectId}/agent-configs/${resolvedAgentConfigId}/convention`,
    { headers },
  );

  const content = templateResponse.data?.data?.content;
  if (typeof content !== 'string') {
    return false;
  }

  const conventionPath = join(projectRoot, CONVENTION_DIR, CONVENTION_INDEX_FILE);
  atomicWriteFileSync(conventionPath, content, 'utf-8');
  return true;
}

export async function conventionDownload(options?: ConventionCommandOptions): Promise<string> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow(options);

  const projectRoot = findProjectRoot(options?.cwd);
  if (!projectRoot) {
    throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
  }

  const conventionRoot = join(projectRoot, CONVENTION_DIR);
  if (!existsSync(conventionRoot)) {
    throw new Error(`Convention directory not found: ${conventionRoot}\nRun 'agentteams init' first.`);
  }

  const hasReportingTemplate = await withSpinner('Downloading reporting template...', () =>
    downloadReportingTemplate(projectRoot, config, apiUrl, headers, options?.agentConfigId),
  );
  // `agentConfigId`를 명시한 호출부(`init`)에게 이 다운로드는 선택이 아니다. 예전 init은
  // 템플릿 응답이 어긋나면 그 자리에서 실패했는데, 기록을 이쪽으로 넘기면서 조용히 넘어가면
  // init은 성공으로 끝나고 `✓ Convention saved`까지 출력하지만 `.agentteams/convention.md`는
  // 없는 상태가 된다. 모든 러너가 always_on으로 읽는 파일이라 그 거짓 성공의 대가가 크다.
  // (agentConfigId를 모르는 직접 실행은 "고를 에이전트가 없음"이 정상 상태라 그대로 둔다.)
  if (options?.agentConfigId && !hasReportingTemplate) {
    throw new Error('Invalid convention template response from server.');
  }
  const platformGuides = await withSpinner('Downloading platform guides...', () =>
    downloadPlatformGuides(projectRoot, apiUrl, headers),
  );
  const platformGuideCount = platformGuides.written;
  // 컨벤션 유무와 무관하게 가이드 해시를 확보한다. 컨벤션 블록 안에서만 가져오면
  // 컨벤션이 없는 프로젝트의 manifest에는 집계 해시가 영원히 비고,
  // `convention status`가 플랫폼 가이드 변경을 절대 감지하지 못한다.
  const platformGuidesHash = await fetchPlatformGuidesHashIfAvailable(apiUrl, headers);

  const conventions = await withSpinner('Downloading conventions...', async () => {
    const conventionList = await fetchConventionsWithContent(apiUrl, config.projectId, headers);
    if (!conventionList || conventionList.length === 0) {
      return conventionList;
    }

    const legacyDir = join(projectRoot, CONVENTION_DIR, LEGACY_CONVENTION_DOWNLOAD_DIR);
    rmSync(legacyDir, { recursive: true, force: true });

    const categoryDirs = new Set<string>();
    for (const convention of conventionList) {
      const categoryName = typeof convention.category === 'string' ? convention.category : '';
      categoryDirs.add(toSafeDirectoryName(categoryName));
    }

    for (const categoryDir of categoryDirs) {
      rmSync(join(projectRoot, CONVENTION_DIR, categoryDir), { recursive: true, force: true });
      mkdirSync(join(projectRoot, CONVENTION_DIR, categoryDir), { recursive: true });
    }

    const fileNameCount = new Map<string, number>();
    const manifest: ConventionDownloadManifestV1 = {
      version: 1,
      generatedAt: new Date().toISOString(),
      platformGuidesHash,
      ...(Object.keys(platformGuides.hashes).length > 0 ? { platformGuideHashes: platformGuides.hashes } : {}),
      entries: [],
    };

    for (const convention of conventionList) {
      const contentMarkdown = typeof convention.contentMarkdown === 'string' ? convention.contentMarkdown : '';

      const baseFileName = buildConventionFileName(convention);
      const categoryName = typeof convention.category === 'string' ? convention.category : '';
      const categoryDir = toSafeDirectoryName(categoryName);
      const duplicateKey = `${categoryDir}/${baseFileName}`;

      const seenCount = fileNameCount.get(duplicateKey) ?? 0;
      fileNameCount.set(duplicateKey, seenCount + 1);

      const fileName = seenCount === 0 ? baseFileName : baseFileName.replace(/\.md$/, `-${seenCount + 1}.md`);
      const filePath = join(projectRoot, CONVENTION_DIR, categoryDir, fileName);
      atomicWriteFileSync(filePath, contentMarkdown, 'utf-8');

      manifest.entries.push({
        conventionId: String(convention.id),
        fileRelativePath: normalizeRelativePath(relative(projectRoot, filePath)),
        fileName,
        categoryDir,
        title: toOptionalString(convention.title),
        category: toOptionalString(convention.category),
        scope: toOptionalString(convention.scope),
        updatedAt: toOptionalString(convention.updatedAt),
        downloadedAt: new Date().toISOString(),
      });
    }

    writeManifest(projectRoot, manifest);
    return conventionList;
  });

  // 컨벤션이 없어 위 블록이 manifest를 쓰지 않고 빠져나간 경우에도 가이드 해시는 남겨야 한다.
  persistPlatformGuideHashes(projectRoot, platformGuides.hashes, platformGuidesHash);

  if (!conventions || conventions.length === 0) {
    if (hasReportingTemplate) {
      const platformLine =
        platformGuideCount > 0
          ? `\nDownloaded ${platformGuideCount} platform guide file(s) into ${CONVENTION_DIR}/platform`
          : '';
      return `Convention sync completed.\nUpdated ${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}\nNo project conventions found.${platformLine}`;
    }

    throw new Error('No conventions found for this project. Create one via the web dashboard first.');
  }

  const reportingLine = hasReportingTemplate ? `Updated ${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}\n` : '';

  const platformLine =
    platformGuideCount > 0
      ? `Downloaded ${platformGuideCount} platform guide file(s) into ${CONVENTION_DIR}/platform\n`
      : '';

  return `Convention sync completed.\n${reportingLine}${platformLine}Downloaded ${conventions.length} file(s) into category directories under ${CONVENTION_DIR}`;
}

function parseConventionMarkdown(fileRelativePath: string, markdown: string): ReturnType<typeof matter> {
  try {
    return matter(markdown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse frontmatter YAML for ${fileRelativePath}: ${reason}`);
  }
}

export async function conventionCreate(options: ConventionCreateOptions): Promise<string> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow(options);
  const projectRoot = findProjectRoot(options?.cwd);
  if (!projectRoot) {
    throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
  }

  const manifest = loadManifestOrCreate(projectRoot);
  const files = toFileList(options.file);
  const results: string[] = [];

  for (const fileInput of files) {
    const cwd = options.cwd ?? process.cwd();
    const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${normalizeRelativePath(relative(projectRoot, absolutePath))}`);
    }

    const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));
    const category = parseCategoryFromAgentteamsPath(fileRelativePath);
    const fileName = basename(absolutePath);

    if (!fileName.toLowerCase().endsWith('.md')) {
      throw new Error(`Convention create requires a .md file: ${fileRelativePath}`);
    }

    const existingEntry = manifest.entries.find((e) => e.fileRelativePath === fileRelativePath);
    if (existingEntry) {
      throw new Error(
        `File is already tracked in the manifest (use update instead): ${fileRelativePath}\n` +
          `- conventionId: ${existingEntry.conventionId}`,
      );
    }

    const localMarkdown = readFileSync(absolutePath, 'utf-8');
    const parsed = parseConventionMarkdown(fileRelativePath, localMarkdown);
    const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    const bodyMarkdown = String(parsed.content ?? '');

    const content = bodyMarkdown;

    const title = toOptionalString(frontmatter.title)?.trim() || fileNameToTitle(fileName);

    const payload: Record<string, unknown> = {
      title,
      category,
      fileName,
      content,
    };

    const trigger = toOptionalString(frontmatter.trigger)?.trim();
    const description = toOptionalString(frontmatter.description)?.trim();
    const agentInstruction = toOptionalString(frontmatter.agentInstruction);
    const scope = toOptionalString(options.scope)?.trim() || toOptionalString(frontmatter.scope)?.trim();

    if (trigger) payload.trigger = trigger;
    if (description) payload.description = description;
    if (typeof agentInstruction === 'string' && agentInstruction.trim().length > 0) {
      payload.agentInstruction = agentInstruction.trimEnd();
    }
    if (scope) payload.scope = scope;

    const response = await withSpinner(`Creating convention for ${fileRelativePath}...`, () =>
      httpClient.post(`${apiUrl}/api/projects/${config.projectId}/conventions`, payload, { headers }),
    );

    const created = response.data?.data as Record<string, unknown> | undefined;
    const createdId = typeof created?.id === 'string' ? created.id : 'unknown';
    const createdUpdatedAt = typeof created?.updatedAt === 'string' ? created.updatedAt : undefined;
    const createdWebUrl = typeof created?.webUrl === 'string' ? created.webUrl : undefined;

    const now = new Date().toISOString();
    manifest.generatedAt = now;
    manifest.entries.push({
      conventionId: createdId,
      fileRelativePath,
      fileName,
      categoryDir: category,
      title,
      category,
      ...(createdUpdatedAt ? { updatedAt: createdUpdatedAt } : {}),
      downloadedAt: now,
      lastUploadedAt: now,
      ...(createdUpdatedAt ? { lastKnownUpdatedAt: createdUpdatedAt } : {}),
    });
    writeManifest(projectRoot, manifest);

    results.push(`[OK] ${fileRelativePath}: Created. (conventionId=${createdId})`);
    if (createdWebUrl) {
      results.push(`webUrl: ${createdWebUrl}`);
    }
    results.push(`[OK] ${CONVENTION_DIR}/${CONVENTION_MANIFEST_FILE}: Updated.`);
    results.push(`[NEXT] Run 'agentteams convention download' to refresh convention.md and canonical markdown.`);
  }

  return results.join('\n');
}

export async function conventionUpdate(options: ConventionUploadOptions): Promise<string> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow(options);
  const projectRoot = findProjectRoot(options?.cwd);
  if (!projectRoot) {
    throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
  }

  const manifest = loadManifestOrThrow(projectRoot);
  const files = toFileList(options.file);
  const apply = options.apply === true;

  const results: string[] = [];

  for (const fileInput of files) {
    const cwd = options.cwd ?? process.cwd();
    const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
    const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));

    const manifestEntry = manifest.entries.find((e) => e.fileRelativePath === fileRelativePath);
    if (!manifestEntry) {
      const available = manifest.entries
        .map((e) => e.fileRelativePath)
        .sort()
        .slice(0, 30);
      throw new Error(
        `Only downloaded convention files can be updated: ${fileInput}\n` +
          `- resolved: ${fileRelativePath}\n` +
          `Run 'agentteams convention download' first, or pass a file path listed in the manifest.\n` +
          (available.length > 0 ? `Examples (partial):\n- ${available.join('\n- ')}` : ''),
      );
    }

    const conventionId = manifestEntry.conventionId;

    const [serverDetail, serverMarkdown, localMarkdown] = await withSpinner(
      `Preparing update for ${fileRelativePath}...`,
      async () => {
        const detailResponse = await httpClient.get(
          `${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`,
          { headers },
        );
        const downloadResponse = await httpClient.get(
          `${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}/download`,
          { headers, responseType: 'text' },
        );
        const local = readFileSync(absolutePath, 'utf-8');
        return [detailResponse.data?.data, String(downloadResponse.data), local] as const;
      },
    );

    if (!hasAnyDiff(serverMarkdown, localMarkdown)) {
      results.push(`[SKIP] ${fileRelativePath}: No changes detected.`);
      continue;
    }

    const diffText = createUnifiedDiff(fileRelativePath, serverMarkdown, localMarkdown);
    results.push(diffText.trimEnd());

    if (!apply) {
      results.push(`[DRY-RUN] ${fileRelativePath}: Printed diff only (no server changes).`);
      continue;
    }

    const parsed = parseConventionMarkdown(fileRelativePath, localMarkdown);
    const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    const bodyMarkdown = String(parsed.content ?? '');

    const content = bodyMarkdown;

    if (typeof serverDetail?.updatedAt !== 'string' || serverDetail.updatedAt.length === 0) {
      throw new Error(`[ERROR] ${fileRelativePath}: Server response is missing updatedAt.`);
    }

    const payload: Record<string, unknown> = {
      updatedAt: serverDetail.updatedAt,
      content,
    };

    const trigger = toOptionalStringOrNullIfPresent(frontmatter, 'trigger');
    const description = toOptionalStringOrNullIfPresent(frontmatter, 'description');
    const agentInstruction = toOptionalStringOrNullIfPresent(frontmatter, 'agentInstruction');

    if (trigger !== undefined) payload.trigger = trigger;
    if (description !== undefined) payload.description = description;
    if (agentInstruction !== undefined) payload.agentInstruction = agentInstruction;

    const updatedResponse = await withSpinner(`Uploading ${fileRelativePath}...`, () =>
      httpClient.put(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`, payload, { headers }),
    );

    const newUpdatedAt = updatedResponse.data?.data?.updatedAt;
    const newWebUrl =
      typeof updatedResponse.data?.data?.webUrl === 'string' ? updatedResponse.data.data.webUrl : undefined;
    const now = new Date().toISOString();
    manifestEntry.lastUploadedAt = now;
    if (typeof newUpdatedAt === 'string') {
      manifestEntry.lastKnownUpdatedAt = newUpdatedAt;
    }
    writeManifest(projectRoot, manifest);

    results.push(`[OK] ${fileRelativePath}: Update applied. (conventionId=${conventionId})`);
    if (newWebUrl) {
      results.push(`webUrl: ${newWebUrl}`);
    }
  }

  return results.join('\n\n');
}

export async function conventionDelete(options: ConventionDeleteOptions): Promise<string> {
  const { config, apiUrl, headers } = await getApiConfigOrThrow(options);
  const projectRoot = findProjectRoot(options?.cwd);
  if (!projectRoot) {
    throw new Error("No .agentteams directory found. Run 'agentteams init' first.");
  }

  const manifest = loadManifestOrThrow(projectRoot);
  const files = toFileList(options.file);
  const apply = options.apply === true;

  const results: string[] = [];

  for (const fileInput of files) {
    const cwd = options.cwd ?? process.cwd();
    const absolutePath = resolveConventionFileAbsolutePath(projectRoot, cwd, fileInput);
    const fileRelativePath = normalizeRelativePath(relative(projectRoot, absolutePath));

    const entryIndex = manifest.entries.findIndex((e) => e.fileRelativePath === fileRelativePath);
    if (entryIndex === -1) {
      const available = manifest.entries
        .map((e) => e.fileRelativePath)
        .sort()
        .slice(0, 30);
      throw new Error(
        `Only downloaded convention files can be deleted: ${fileInput}\n` +
          `- resolved: ${fileRelativePath}\n` +
          `Run 'agentteams convention download' first, or pass a file path listed in the manifest.\n` +
          (available.length > 0 ? `Examples (partial):\n- ${available.join('\n- ')}` : ''),
      );
    }

    const entry = manifest.entries[entryIndex]!;
    const conventionId = entry.conventionId;

    results.push(`[PLAN] ${fileRelativePath}: Will delete conventionId=${conventionId}`);

    if (!apply) {
      results.push(`[DRY-RUN] ${fileRelativePath}: Planned only (no server delete).`);
      continue;
    }

    await withSpinner(`Deleting convention for ${fileRelativePath}...`, () =>
      httpClient.delete(`${apiUrl}/api/projects/${config.projectId}/conventions/${conventionId}`, {
        headers: withoutJsonContentType(headers),
      }),
    );

    // After a successful server delete, also clean up local files/manifest.
    try {
      unlinkSync(absolutePath);
    } catch {
      // ignore
    }
    manifest.entries.splice(entryIndex, 1);
    writeManifest(projectRoot, manifest);

    results.push(`[OK] ${fileRelativePath}: Deleted. (conventionId=${conventionId})`);
  }

  return results.join('\n');
}
