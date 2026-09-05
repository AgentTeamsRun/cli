export declare const DEFAULT_CONVENTION_REFERENCE = "---\nalwaysApply: true\n---\n\n# AGENT_RULES\n\n`.agentteams/convention.md` holds this project's conventions.\n\n- **Read it once per session**, before your first substantive action.\n- **Do not re-read it for each task.** Once it is in context, use what you already read.\n- Re-read only when it changed \u2014 `agentteams session sync` lists changed files under `reread`.\n";
/**
 * Entry point bodies earlier CLI versions wrote verbatim. An exact match proves
 * the file is still the one we generated — nobody edited it — so refreshing it in
 * place is safe, the same reasoning the managed post-checkout hook applies to
 * its marker line.
 *
 * Never drop an entry. A repository initialized by any released CLI has to keep
 * being recognized as managed; otherwise `doctor` reports `entry-point-conflict`
 * for a file the user never touched.
 */
export declare const LEGACY_CONVENTION_REFERENCES: readonly string[];
export declare const POST_CHECKOUT_HOOK_MARKER = "# AgentTeams managed post-checkout hook";
export declare const POST_CHECKOUT_HOOK_SCRIPT = "#!/bin/sh\n# AgentTeams managed post-checkout hook\n# Materializes AgentTeams convention entry points in a fresh linked worktree.\n# This hook must never fail the checkout: it always exits 0.\n\nprevious_head=\"$1\"\nbranch_checkout=\"$3\"\n\nif [ \"$branch_checkout\" != \"1\" ]; then\n  exit 0\nfi\n\n# git worktree add reports the previous HEAD as the all-zero object id; a\n# regular branch checkout reports the real previous commit, which must not\n# trigger a bootstrap.\ncase \"$previous_head\" in\n  0000000000000000000000000000000000000000 | 0000000000000000000000000000000000000000000000000000000000000000) ;;\n  *)\n    exit 0\n    ;;\nesac\n\nif ! command -v agentteams >/dev/null 2>&1; then\n  echo \"agentteams: skipped worktree bootstrap (agentteams CLI not found in PATH)\" >&2\n  exit 0\nfi\n\nif ! agentteams init --format json >/dev/null 2>&1; then\n  echo \"agentteams: worktree bootstrap failed (agentteams init exited non-zero)\" >&2\nfi\n\nexit 0\n";
export type ConventionLinkState = 'absent' | 'ready' | 'broken' | 'wrong-target' | 'occupied';
export type ConventionIssueCode = 'not-a-git-repo' | 'root-agentteams-missing' | 'link-broken' | 'link-wrong-target' | 'link-occupied' | 'link-create-failed' | 'link-backup-retained' | 'exclude-read-failed' | 'exclude-write-failed' | 'exclude-unsafe-path' | 'entry-point-write-failed' | 'entry-point-conflict' | 'hook-custom' | 'hook-hookspath' | 'hook-read-failed' | 'hook-write-failed' | 'hook-unsafe-path';
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
    /** Set only when a stale managed body was refreshed in place on this run. */
    upgraded?: boolean;
}
export interface EnsureConventionEntryPointsResult {
    entries: ConventionEntryPointEntry[];
    issues: ConventionIssue[];
    changedCount: number;
    ready: boolean;
}
/** Anchored pattern for `git-common-dir/info/exclude` (repo-root relative). */
export declare function toAnchoredExcludePattern(relativePath: string): string;
export declare function resolveGitCommonDir(repoDir: string): string | null;
export declare function isReadableRegularFile(path: string): boolean;
/**
 * Refresh an entry point whose body is still one a previous CLI version wrote.
 * The comparison is exact, so a single user edit takes the file out of scope
 * and it is left alone.
 *
 * Returns `true` only when the file changed on disk. An already-current file,
 * a user-edited one, a symlink, and an unreadable path all return `false`, so
 * callers can count a `true` as one change without re-reading the file.
 */
export declare function upgradeLegacyConventionReference(fullPath: string): boolean;
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
 * `core.hooksPath` pointing somewhere other than the default hooks directory,
 * or an unmanaged hook, blocks installation — silently redirecting
 * user-managed hook infrastructure is never safe.
 */
export declare function ensurePostCheckoutHook(repoDir: string): EnsurePostCheckoutHookResult;
//# sourceMappingURL=conventionLink.d.ts.map