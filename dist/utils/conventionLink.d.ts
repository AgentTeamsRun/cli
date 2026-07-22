export declare const DEFAULT_CONVENTION_REFERENCE = "---\nalwaysApply: true\n---\n\n# AGENT_RULES\n\n**Before starting any task, always refer to `.agentteams/convention.md`.**\n";
export declare const POST_CHECKOUT_HOOK_MARKER = "# AgentTeams managed post-checkout hook";
export declare const POST_CHECKOUT_HOOK_SCRIPT = "#!/bin/sh\n# AgentTeams managed post-checkout hook\n# Materializes AgentTeams convention entry points in a fresh linked worktree.\n# This hook must never fail the checkout: it always exits 0.\n\nprevious_head=\"$1\"\nbranch_checkout=\"$3\"\n\nif [ \"$branch_checkout\" != \"1\" ]; then\n  exit 0\nfi\n\n# git worktree add reports the previous HEAD as the all-zero object id; a\n# regular branch checkout reports the real previous commit, which must not\n# trigger a bootstrap.\ncase \"$previous_head\" in\n  0000000000000000000000000000000000000000 | 0000000000000000000000000000000000000000000000000000000000000000) ;;\n  *)\n    exit 0\n    ;;\nesac\n\nif ! command -v agentteams >/dev/null 2>&1; then\n  echo \"agentteams: skipped worktree bootstrap (agentteams CLI not found in PATH)\" >&2\n  exit 0\nfi\n\nif ! agentteams init --format json >/dev/null 2>&1; then\n  echo \"agentteams: worktree bootstrap failed (agentteams init exited non-zero)\" >&2\nfi\n\nexit 0\n";
export type ConventionLinkState = 'absent' | 'ready' | 'broken' | 'wrong-target' | 'occupied';
export type ConventionIssueCode = 'not-a-git-repo' | 'root-agentteams-missing' | 'link-broken' | 'link-wrong-target' | 'link-occupied' | 'link-create-failed' | 'exclude-read-failed' | 'exclude-write-failed' | 'exclude-unsafe-path' | 'entry-point-write-failed' | 'entry-point-conflict' | 'hook-custom' | 'hook-hookspath' | 'hook-read-failed' | 'hook-write-failed' | 'hook-unsafe-path';
export interface ConventionIssue {
    code: ConventionIssueCode;
    path: string;
    message: string;
}
export interface EnsureConventionLinkResult {
    status: 'ready' | 'blocked';
    state: ConventionLinkState;
    changed: boolean;
    linkPath: string;
    issue?: ConventionIssue;
}
export interface EnsureLocalExcludeResult {
    status: 'ready' | 'blocked';
    changed: boolean;
    excludePath: string | null;
    addedPatterns: string[];
    issue?: ConventionIssue;
}
export interface EnsurePostCheckoutHookResult {
    status: 'ready' | 'blocked';
    changed: boolean;
    hookPath: string | null;
    issue?: ConventionIssue;
}
export type ConventionEntryPointState = 'created' | 'tracked' | 'existing' | 'blocked';
export interface ConventionEntryPointEntry {
    relativePath: string;
    state: ConventionEntryPointState;
    compatible: boolean;
}
export interface EnsureConventionEntryPointsResult {
    entries: ConventionEntryPointEntry[];
    issues: ConventionIssue[];
    changedCount: number;
    ready: boolean;
}
/** Anchored pattern for `git-common-dir/info/exclude` (repo-root relative). */
export declare function toAnchoredExcludePattern(relativePath: string): string;
export declare function isReadableRegularFile(path: string): boolean;
export declare function ensureConventionEntryPoints(repoDir: string, relativePaths: string[], options: {
    allowCreate: boolean;
    validateExistingReference: boolean;
}): EnsureConventionEntryPointsResult;
/**
 * Classify the `.agentteams` entry of a member repository. Correctness is
 * judged by the canonical target — not the raw link string — so both POSIX
 * relative symlinks and Windows junctions count as `ready` when they resolve
 * to the convention root's `.agentteams`.
 */
export declare function inspectConventionLink(rootDir: string, repoDir: string): ConventionLinkState;
/**
 * Create the `.agentteams` link only when nothing exists at the path yet.
 * Existing entries — broken links, links to another target, or real files and
 * directories — are preserved and surfaced as issues. A copy fallback is
 * intentionally not offered because copies break the sync guarantee.
 */
export declare function ensureConventionLink(rootDir: string, repoDir: string): EnsureConventionLinkResult;
/**
 * Register anchored patterns in `git-common-dir/info/exclude`. The exclude
 * file is shared by every linked worktree, unlike the tracked `.gitignore`,
 * which must never be modified. Existing content and line endings are
 * preserved; each pattern is appended at most once (exact-line match).
 */
export declare function ensureLocalExclude(repoDir: string, patterns: string[]): EnsureLocalExcludeResult;
/**
 * Install or refresh the managed `post-checkout` hook in
 * `git-common-dir/hooks`. A hook is only written when no hook exists or the
 * existing hook carries the exact managed marker on its second line. A
 * non-empty `core.hooksPath` or an unmanaged hook blocks installation —
 * silently redirecting user-managed hook infrastructure is never safe.
 */
export declare function ensurePostCheckoutHook(repoDir: string): EnsurePostCheckoutHookResult;
//# sourceMappingURL=conventionLink.d.ts.map