/** Record kinds whose guide can be handed to an agent. These are the write-enabled kinds. */
export declare const GUIDE_RECORD_KINDS: readonly ["document", "comment"];
export type GuideRecordKind = (typeof GUIDE_RECORD_KINDS)[number];
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