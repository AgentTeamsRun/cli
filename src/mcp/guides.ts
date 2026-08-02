import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectConfig } from '../utils/config.js';
import httpClient from '../utils/httpClient.js';

/**
 * Platform-guide loader for the MCP write path.
 *
 * Guides are read from the local `.agentteams/platform/` copy when this session
 * actually sits in the bound project: the write contract only needs the body
 * plus the hash the server will compare against, and both are written by
 * `agentteams convention download`.
 *
 * That local copy cannot be assumed, though. `context.ts` resolves credentials
 * and `projectId` from CLI options and `AGENTTEAMS_*` env vars precisely because
 * an externally spawned MCP server's cwd may sit outside the project — or inside
 * a *different* one. So the local path is used only when the caller hands over a
 * verified project root, and the server is the fallback: `GET /api/platform/guides`
 * returns body and hash together, which is always a consistent pair.
 *
 * This module must not import the MCP SDK (see `test/mcp-boundary.test.ts`).
 */

const CONVENTION_DIR = '.agentteams';
const PLATFORM_DIR = 'platform';
const MANIFEST_FILE = 'conventions.manifest.json';

const RESYNC_HINT = "Run 'agentteams convention download' and retry.";

/** Record kinds whose guide can be handed to an agent. These are the write-enabled kinds. */
export const GUIDE_RECORD_KINDS = ['document', 'comment'] as const;
export type GuideRecordKind = (typeof GUIDE_RECORD_KINDS)[number];

const GUIDE_FILE_NAMES: Record<GuideRecordKind, string> = {
  document: 'document-guide.md',
  comment: 'comment-guide.md',
};

export interface LoadedGuide {
  recordKind: GuideRecordKind;
  fileName: string;
  /** Where the body came from: the local sync, or a live server read. */
  source: 'local' | 'server';
  /** Absolute path of the local file the body came from. Absent for a server read. */
  filePath?: string;
  content: string;
  /**
   * The hash to send as `guideHash`. `null` when the local manifest predates
   * per-guide hashes — callers must then omit `guideHash` rather than invent one.
   */
  guideHash: string | null;
}

type ConventionManifest = {
  platformGuideHashes?: Record<string, string>;
};

type ServerPlatformGuide = {
  fileName?: unknown;
  content?: unknown;
  hash?: unknown;
};

/** Project root = the directory containing `.agentteams/config.json`. */
export function findGuideProjectRoot(cwd: string = process.cwd()): string | null {
  const configPath = findProjectConfig(cwd);
  if (!configPath) {
    return null;
  }
  return resolve(configPath, '..', '..');
}

function readManifestHashes(projectRoot: string): Record<string, string> | null {
  const manifestPath = join(projectRoot, CONVENTION_DIR, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ConventionManifest;
    return parsed?.platformGuideHashes ?? null;
  } catch {
    // A corrupt manifest is indistinguishable from a missing one for this purpose:
    // both mean "the local hash is unknown", and both are fixed by re-syncing.
    return null;
  }
}

function resolveGuideFileName(recordKind: GuideRecordKind): string {
  const fileName = GUIDE_FILE_NAMES[recordKind];
  if (!fileName) {
    throw new Error(`Unknown guide record kind: ${recordKind}. Supported: ${GUIDE_RECORD_KINDS.join(', ')}`);
  }
  return fileName;
}

/**
 * Load one platform guide from a local project copy.
 *
 * Returns `null` when this session has no usable local copy — the caller then
 * falls back to the server rather than failing, so a session bound to a project
 * it does not sit in can still follow the guide-first contract.
 */
export function loadLocalPlatformGuide(recordKind: GuideRecordKind, projectRoot: string | null): LoadedGuide | null {
  const fileName = resolveGuideFileName(recordKind);
  if (!projectRoot) {
    return null;
  }

  const filePath = join(projectRoot, CONVENTION_DIR, PLATFORM_DIR, fileName);
  if (!existsSync(filePath)) {
    return null;
  }

  const hashes = readManifestHashes(projectRoot);

  return {
    recordKind,
    fileName,
    source: 'local',
    filePath,
    content: readFileSync(filePath, 'utf-8'),
    guideHash: hashes?.[fileName] ?? null,
  };
}

/** Read one guide straight from the server, where body and hash always match. */
export async function fetchPlatformGuide(
  recordKind: GuideRecordKind,
  apiUrl: string,
  headers: Record<string, string>,
): Promise<LoadedGuide> {
  const fileName = resolveGuideFileName(recordKind);
  const normalizedApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const response = await httpClient.get(`${normalizedApiUrl}/api/platform/guides`, { headers });

  const guides = (response.data?.data ?? []) as ServerPlatformGuide[];
  const guide = Array.isArray(guides) ? guides.find((item) => item?.fileName === fileName) : undefined;
  if (!guide || typeof guide.content !== 'string') {
    throw new Error(`Platform guide ${fileName} is not published by ${normalizedApiUrl}.`);
  }

  return {
    recordKind,
    fileName,
    source: 'server',
    content: guide.content,
    guideHash: typeof guide.hash === 'string' && guide.hash.length > 0 ? guide.hash : null,
  };
}

/**
 * Resolve the guide an agent must follow before a write: local copy first,
 * server otherwise.
 *
 * `projectRoot` is the root this MCP session is actually bound to. It is passed
 * in (not discovered here) so a cwd that happens to sit in some *other* project
 * cannot feed that project's stale hash into this project's write — which would
 * produce a `GUIDE_OUTDATED` 409 whose documented fix (`convention download`)
 * does not resolve it.
 */
export async function resolvePlatformGuide(
  recordKind: GuideRecordKind,
  options: { projectRoot?: string | null; apiUrl: string; headers: Record<string, string> },
): Promise<LoadedGuide> {
  const local = loadLocalPlatformGuide(recordKind, options.projectRoot ?? null);
  if (local) {
    return local;
  }

  try {
    return await fetchPlatformGuide(recordKind, options.apiUrl, options.headers);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not load the ${resolveGuideFileName(recordKind)} platform guide. ` +
        `No local copy is available for this session, and reading it from the server failed: ${reason}. ` +
        `Run 'agentteams convention download' in the project, or check the API connection.`,
    );
  }
}

/**
 * Human-readable note explaining why `guideHash` is absent, so an agent reading
 * the tool output knows the freshness check is not being enforced for this call.
 */
export function describeMissingGuideHash(guide: LoadedGuide): string | null {
  if (guide.guideHash) {
    return null;
  }
  return (
    `No recorded hash for ${guide.fileName} — this project's manifest predates per-guide hashes. ` +
    `Writes will skip the guide freshness check. ${RESYNC_HINT}`
  );
}
