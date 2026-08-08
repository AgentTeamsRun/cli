import { defineToolDiscoveryMetadata, executeContextTool } from '@agentteams/context-tools';
import { existsSync } from 'node:fs';
import { posix, resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import { getLinearIssue } from '../api/linear.js';
import { getPlanTask } from '../api/task.js';
import { parseEntityRef, SUPPORTED_REF_FORMS } from '../utils/entityRef.js';
import { GUIDE_RECORD_KINDS, describeMissingGuideHash, resolvePlatformGuide } from './guides.js';
import { createCliContextToolsClient } from './tools.js';
/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
export const resolveToolHeaders = (context) => context.resolveHeaders?.() ?? Promise.resolve(context.headers);
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
const guideGetSpec = {
    name: 'agentteams_guide_get',
    title: 'Get AgentTeams Record Guide',
    description: [
        'Fetch the platform guide that governs how a record type must be written.',
        'Reads this project’s local copy when the session sits in it, and falls back to the server otherwise.',
        'Returns the full guide body plus the guideHash to pass to the matching write tool.',
        'Read this before any AgentTeams write tool call — the rules it states (visibility, tag policy, structure) are enforced server-side.',
        'If it reports that the local guide hash is unknown, run `agentteams convention download` in the project.',
    ].join(' '),
    discovery: guideDiscovery,
    inputSchema: z.strictObject({
        recordKind: z
            .enum(GUIDE_RECORD_KINDS)
            .describe('Record type whose guide you need. "document" and "comment" are write-enabled.'),
    }),
    handler: async (args, context) => {
        const guide = await resolvePlatformGuide(args.recordKind, {
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
 * Body-bearing and record references both end up inlined, so one map covers
 * both CLI `kind`s. Absent types (`planTask`, `LINEAR_ISSUE`) have no shared
 * read tool and are dispatched to the CLI API layer directly.
 */
const READ_TOOL_BY_REF_TYPE = {
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
function containedConventionPath(path) {
    const normalized = posix.normalize(path.replaceAll('\\', '/'));
    if (posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized))
        return null;
    const relative = posix.relative(CONVENTION_PATH_ROOT, normalized);
    if (relative.length === 0 || relative.startsWith('..'))
        return null;
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
function describeLocalFile(path, projectRoot) {
    if (!projectRoot) {
        return {
            message: `Read this project file yourself: ${path} (relative to the project root — this session is not bound to a local checkout)`,
            path,
        };
    }
    const filePath = resolvePath(projectRoot, path);
    if (!existsSync(filePath))
        return null;
    return { message: `Read this project file yourself: ${filePath}`, path, filePath };
}
async function resolveInlineRecord(parsed, context) {
    if (parsed.refType === 'planTask') {
        // Not in the shared `ContextToolsClient` contract — see the module note.
        return getPlanTask(context.apiUrl, context.projectId, await resolveToolHeaders(context), parsed.id, parsed.parentId);
    }
    if (parsed.refType === 'LINEAR_ISSUE') {
        // `projectId` is not optional in practice: without it a personal-token
        // session (the default for `agentteams mcp`) gets 401 from the Linear route.
        return getLinearIssue(context.apiUrl, await resolveToolHeaders(context), parsed.id, context.projectId);
    }
    const toolName = READ_TOOL_BY_REF_TYPE[parsed.refType];
    if (!toolName) {
        throw new Error(`No MCP read tool for reference type: ${parsed.refType}`);
    }
    // Delegating keeps truncation and `omitDocumentEditorMirror` defined once, in
    // the read tool, instead of forking a second policy here.
    return executeContextTool(toolName, parsed.refType === 'codeReviewFinding' && parsed.parentId
        ? { id: parsed.id, codeReviewId: parsed.parentId }
        : { id: parsed.id }, createCliContextToolsClient(context));
}
const resolveSpec = {
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
    handler: async (args, context) => {
        const parsed = parseEntityRef(args.ref);
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
            message: `${parsed.refType} resolved`,
            record: await resolveInlineRecord(parsed, context),
        };
    },
};
/** Every CLI-local non-write tool the MCP server exposes, in registration order. */
export function getLocalToolSpecs() {
    return [guideGetSpec, resolveSpec];
}
//# sourceMappingURL=localTools.js.map