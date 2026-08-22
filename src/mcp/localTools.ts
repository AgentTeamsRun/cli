import { defineToolDiscoveryMetadata, executeContextTool, type ToolDiscoveryMetadata } from '@agentteams/context-tools';
import { existsSync } from 'node:fs';
import { posix, resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import { getLinearIssue } from '../api/linear.js';
import { getSentryIssue } from '../api/sentry.js';
import { getPlanTask } from '../api/task.js';
import { parseEntityRef, SUPPORTED_REF_FORMS, type ParsedEntityRef } from '../utils/entityRef.js';
import type { McpToolContext } from './context.js';
import { GUIDE_RECORD_KINDS, describeMissingGuideHash, resolvePlatformGuide, type GuideRecordKind } from './guides.js';
import { createCliContextToolsClient } from './tools.js';

/**
 * MCP tools that are **CLI-local** rather than shared.
 *
 * Two different reasons land a tool here, and both are about what the shared
 * `@agentteams/context-tools` package may advertise:
 *
 * - `agentteams_guide_get` reads a guide from the *local* checkout, so it only
 *   means anything in a process that sits in the project.
 * - `agentteams_resolve` reaches endpoints the shared `ContextToolsClient`
 *   contract does not expose (plan tasks, and Linear — which is not even
 *   project-scoped), so putting it in the package would mean widening that
 *   contract for every consumer.
 *
 * Write tools live next door in `writeTools.ts` for a third, stricter reason
 * (see the boundary note there). The spec shape below is shared by both files:
 * `handler(args, context)` receives the {@link McpToolContext}, unlike shared
 * read specs which receive a `ContextToolsClient`. No MCP SDK import belongs
 * here — `server.ts` is the only adapter (see `test/mcp-boundary.test.ts`).
 */
export interface McpLocalToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  discovery: ToolDiscoveryMetadata;
  handler(args: Record<string, unknown>, context: McpToolContext): Promise<unknown>;
}

/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
export const resolveToolHeaders = (context: McpToolContext): Promise<Record<string, string>> =>
  context.resolveHeaders?.() ?? Promise.resolve(context.headers);

const guideDiscovery = defineToolDiscoveryMetadata({
  domain: 'guides',
  profiles: ['full', 'documents', 'comments'],
});

/**
 * `search` on purpose: resolving a reference is the same "find the record this
 * text points at" job, and a new discovery domain would have to be added to the
 * shared package — a release chain this CLI-local tool exists to avoid.
 *
 * `full` only. The narrow profiles are scoped surfaces (`documents` may not read
 * plans, `minimal` is defined as exactly the always-on set), and this tool
 * dispatches to *every* entity type — advertising it inside a narrow profile
 * would hand that profile a way around its own scope.
 *
 * `deferable` is left at its default (true) on purpose: in the shared package
 * `deferable: false` marks the always-on `minimal` set, and a `full`-only tool
 * this size has no business being pre-loaded into every request.
 */
const resolveDiscovery = defineToolDiscoveryMetadata({
  domain: 'search',
  profiles: ['full'],
});

const guideGetSpec: McpLocalToolSpec = {
  name: 'agentteams_guide_get',
  title: 'Get AgentTeams Record Guide',
  description: [
    'Fetch the platform guide that governs a record type — how to write it, and the workflow around it.',
    'Reads this project’s local copy when the session sits in it, and falls back to the server otherwise.',
    'Returns the full guide body plus the guideHash to pass to the matching write tool.',
    'Read this before creating, updating, or deleting any AgentTeams platform record — the rules it states (visibility, tag policy, structure) are enforced server-side.',
    'If it reports that the local guide hash is unknown, run `agentteams convention download` in the project.',
  ].join(' '),
  discovery: guideDiscovery,
  inputSchema: z.strictObject({
    recordKind: z
      .enum(GUIDE_RECORD_KINDS)
      .describe(
        'Record type or workflow whose guide you need. "document", "comment", "co-action", "post-mortem" and "code-review" back MCP write contracts and return a guideHash the write tool compares; the rest are read-only references.',
      ),
  }),
  handler: async (args, context) => {
    const guide = await resolvePlatformGuide(args.recordKind as GuideRecordKind, {
      projectRoot: context.projectRoot,
      apiUrl: context.apiUrl,
      headers: await resolveToolHeaders(context),
    });
    const warning = describeMissingGuideHash(guide);
    return {
      recordKind: guide.recordKind,
      fileName: guide.fileName,
      source: guide.source,
      ...(guide.filePath ? { filePath: guide.filePath } : {}),
      guideHash: guide.guideHash,
      content: guide.content,
      ...(warning ? { warning } : {}),
    };
  },
};

/**
 * How a resolved reference comes back over MCP.
 *
 * Deliberately narrower than the CLI command's `ResolveResult`: there is no
 * `file` kind and no `filePath` for body-bearing entities. The command can
 * download a plan to disk because it runs in the project; an MCP server is
 * spawned by an arbitrary client with no cwd or filesystem contract, so the body
 * is inlined through the existing read tool instead. `localFile` survives —
 * there the path is *carried by the reference itself*, not produced by us — and
 * it is anchored to `projectRoot` whenever this session has one.
 */
export interface McpResolveResult {
  message: string;
  kind: 'record' | 'localFile' | 'external';
  refType: string;
  id: string;
  parentId?: string;
  /** Project-root-relative path carried by a `convention:id:path` reference. */
  path?: string;
  /**
   * The same path anchored to {@link McpToolContext.projectRoot}. Absent when
   * this session has no verified local checkout — then `path` is all we can
   * honestly say, and the agent has to supply its own base.
   */
  filePath?: string;
  url?: string;
  suggestedCommand?: string;
  fallbackCommand: string;
  record?: unknown;
}

/**
 * Body-bearing and record references both end up inlined, so one map covers
 * both CLI `kind`s. Absent types (`planTask`, `LINEAR_ISSUE`) have no shared
 * read tool and are dispatched to the CLI API layer directly.
 */
const READ_TOOL_BY_REF_TYPE: Record<string, string> = {
  plan: 'agentteams_plan_get',
  completionReport: 'agentteams_report_get',
  postMortem: 'agentteams_postmortem_get',
  coAction: 'agentteams_coaction_get',
  document: 'agentteams_document_get',
  convention: 'agentteams_convention_get',
  codeReview: 'agentteams_codereview_get',
  codeReviewFinding: 'agentteams_codereview_finding_get',
};

/** Conventions are only ever deployed under `.agentteams/`. */
const CONVENTION_PATH_ROOT = '.agentteams';

/**
 * A reference is user-authored text, and this envelope turns its path segment
 * into a machine-readable "read this file" instruction — so the path has to stay
 * inside the project's `.agentteams/` subtree or a crafted reference could
 * nominate any file on the machine. The check is purely lexical, and runs before
 * the path is anchored to anything; a path that escapes degrades to the server
 * record rather than being trusted.
 */
function containedConventionPath(path: string): string | null {
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  if (posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return null;
  const relative = posix.relative(CONVENTION_PATH_ROOT, normalized);
  if (relative.length === 0 || relative.startsWith('..')) return null;
  return normalized;
}

/**
 * Turn a contained relative path into the envelope's local-file fields, or null
 * when the caller should fall back to the server record.
 *
 * With a verified {@link McpToolContext.projectRoot} the path is anchored and
 * checked for existence, so a convention that was never downloaded degrades to
 * the server copy exactly like `agentteams resolve` does — an MCP server is
 * spawned from an arbitrary cwd, so a bare relative path would otherwise be read
 * against the host agent's directory and could hit an unrelated repository's
 * file of the same name. Without a project root the relative path is still the
 * most this tool knows, and the message has to say what it is relative to.
 */
function describeLocalFile(
  path: string,
  projectRoot: string | undefined,
): Pick<McpResolveResult, 'message' | 'path' | 'filePath'> | null {
  if (!projectRoot) {
    return {
      message: `Read this project file yourself: ${path} (relative to the project root — this session is not bound to a local checkout)`,
      path,
    };
  }

  const filePath = resolvePath(projectRoot, path);
  if (!existsSync(filePath)) return null;
  return { message: `Read this project file yourself: ${filePath}`, path, filePath };
}

async function resolveInlineRecord(parsed: ParsedEntityRef, context: McpToolContext): Promise<unknown> {
  if (parsed.refType === 'planTask') {
    // Not in the shared `ContextToolsClient` contract — see the module note.
    return getPlanTask(
      context.apiUrl,
      context.projectId,
      await resolveToolHeaders(context),
      parsed.id,
      parsed.parentId,
    );
  }
  if (parsed.refType === 'LINEAR_ISSUE') {
    // `projectId` is not optional in practice: without it a personal-token
    // session (the default for `agentteams mcp`) gets 401 from the Linear route.
    return getLinearIssue(context.apiUrl, await resolveToolHeaders(context), parsed.id, context.projectId);
  }
  if (parsed.refType === 'SENTRY_ISSUE') {
    // 서버가 프로젝트 바인딩을 검증하고 저장된 permalink를 함께 돌려준다. 토큰이 나르는 숫자
    // ID만으로는 permalink를 만들 수 없으므로, 이 경로가 곧 "링크를 지어내지 않는" 보장이다.
    return getSentryIssue(context.apiUrl, context.projectId, await resolveToolHeaders(context), parsed.id);
  }

  const toolName = READ_TOOL_BY_REF_TYPE[parsed.refType];
  if (!toolName) {
    throw new Error(`No MCP read tool for reference type: ${parsed.refType}`);
  }
  // Delegating keeps truncation and `omitDocumentEditorMirror` defined once, in
  // the read tool, instead of forking a second policy here.
  return executeContextTool(
    toolName,
    parsed.refType === 'codeReviewFinding' && parsed.parentId
      ? { id: parsed.id, codeReviewId: parsed.parentId }
      : { id: parsed.id },
    createCliContextToolsClient(context),
  );
}

const resolveSpec: McpLocalToolSpec = {
  name: 'agentteams_resolve',
  title: 'Resolve an AgentTeams Entity Reference',
  description: [
    'Resolve one entity reference token from a user message, plan body, or comment — pass it verbatim and this works out the type for you.',
    `Accepted forms: ${SUPPORTED_REF_FORMS}.`,
    'Use this when the type has to be worked out from the token; when you already know the type, the matching agentteams_*_get tool is cheaper.',
    'Act on the returned kind: `record` → use the inline payload; `localFile` → read the returned `filePath` yourself, falling back to the project-root-relative `path` when no `filePath` is given (this tool never reads local files); `external` → open `url` or run `suggestedCommand` (`gh`, `glab`), which this tool never executes.',
    'Body-bearing entities (plan, completionReport, postMortem, coAction, document) come back as `record` with their content inline — nothing is written to disk.',
    'AgentTeams references are scoped to the single project this MCP server is bound to.',
  ].join(' '),
  discovery: resolveDiscovery,
  inputSchema: z.strictObject({
    ref: z
      .string()
      .min(1)
      .describe('The reference token exactly as it appears, including any surrounding [label](...) markdown link.'),
  }),
  handler: async (args, context): Promise<McpResolveResult> => {
    const parsed = parseEntityRef(args.ref as string);
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
      const contained = parsed.path ? containedConventionPath(parsed.path) : null;
      const localFile = contained ? describeLocalFile(contained, context.projectRoot) : null;
      if (localFile) {
        return { ...base, kind: 'localFile', ...localFile };
      }
      return {
        ...base,
        kind: 'record',
        message: contained
          ? `Local path not found under ${CONVENTION_PATH_ROOT}/ (${parsed.path}); returning the server record instead`
          : `Path outside ${CONVENTION_PATH_ROOT}/ (${parsed.path}); returning the server record instead`,
        record: await resolveInlineRecord(parsed, context),
      };
    }

    return {
      ...base,
      kind: 'record',
      // 다른 kind와 마찬가지로 서술이 아니라 지시여야 한다 — 호출부가 `kind`별 규칙을 따로
      // 갖지 않고 이 문장만 따르면 되도록.
      message: `${parsed.refType} resolved — use the inline \`record\` payload`,
      record: await resolveInlineRecord(parsed, context),
    };
  },
};

/** Every CLI-local non-write tool the MCP server exposes, in registration order. */
export function getLocalToolSpecs(): McpLocalToolSpec[] {
  return [guideGetSpec, resolveSpec];
}
