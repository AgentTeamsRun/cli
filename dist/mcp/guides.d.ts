/**
 * Record kinds whose guide can be handed to an agent — **every** guide the platform ships, not just
 * the write-enabled ones.
 *
 * This list was once the five write-enabled kinds, and the other fourteen were reachable only
 * through a hand-written routing table in `convention.md`. That table was a copy of each guide's own
 * frontmatter description, it drifted (six files were missing), and it cost ~1.8k always-on chars.
 * Opening the accessor is what let it be deleted: the mapping now lives in one testable place.
 *
 * ⚠️ Mirror pair with `platformGuideMetas` in `api/src/services/platformGuides.ts`. Adding a guide
 * there without adding it here leaves it unreachable by name; `test/guide-mcp-tool-smoke.test.ts`
 * guards the pair.
 */
export declare const GUIDE_RECORD_KINDS: readonly ["plan", "plan-authoring", "plan-execution", "plan-template-minimal", "plan-template-standard", "plan-template-full", "completion-report", "document", "comment", "code-review", "convention-authoring", "convention-setup", "convention-update", "skill", "post-mortem", "co-action", "linear", "sentry", "runner-history"];
export type GuideRecordKind = (typeof GUIDE_RECORD_KINDS)[number];
/**
 * Kinds whose guide backs an MCP write contract. `guide_get` returns a `guideHash` for every kind
 * (the manifest carries all of them), but only these are compared server-side on write — for the
 * rest the hash is informational.
 */
export declare const WRITE_ENABLED_GUIDE_RECORD_KINDS: readonly ["document", "comment", "co-action", "post-mortem", "code-review"];
/** Guide file name per record kind. Exported so guards can check the shipped file, not a copy of this map. */
export declare const GUIDE_FILE_NAMES: Record<GuideRecordKind, string>;
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
/** Project root = the directory containing `.agentteams/config.json`. */
export declare function findGuideProjectRoot(cwd?: string): string | null;
/**
 * Load one platform guide from a local project copy.
 *
 * Returns `null` when this session has no usable local copy — the caller then
 * falls back to the server rather than failing, so a session bound to a project
 * it does not sit in can still follow the guide-first contract.
 */
export declare function loadLocalPlatformGuide(recordKind: GuideRecordKind, projectRoot: string | null): LoadedGuide | null;
/** Read one guide straight from the server, where body and hash always match. */
export declare function fetchPlatformGuide(recordKind: GuideRecordKind, apiUrl: string, headers: Record<string, string>): Promise<LoadedGuide>;
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
export declare function resolvePlatformGuide(recordKind: GuideRecordKind, options: {
    projectRoot?: string | null;
    apiUrl: string;
    headers: Record<string, string>;
}): Promise<LoadedGuide>;
/**
 * Human-readable note explaining why `guideHash` is absent, so an agent reading
 * the tool output knows the freshness check is not being enforced for this call.
 */
export declare function describeMissingGuideHash(guide: LoadedGuide): string | null;
//# sourceMappingURL=guides.d.ts.map