export interface GitMetrics {
    commitHash?: string;
    commitStart?: string;
    commitEnd?: string;
    branchName?: string;
    pullRequestId?: string;
    durationSeconds?: number;
    filesModified?: number;
    linesAdded?: number;
    linesDeleted?: number;
    qualityScore?: number;
}
type ExecFileSyncFn = (file: string, args: readonly string[], options: {
    cwd?: string;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'ignore'];
    windowsHide?: boolean;
}) => string;
export declare function collectGitMetrics(execFileSyncImpl?: ExecFileSyncFn, options?: {
    startCommit?: string;
}): GitMetrics;
export declare function getGitRemoteOriginUrl(execFileSyncImpl?: ExecFileSyncFn, cwd?: string): string | undefined;
export declare function resolveMainCheckoutRoot(cwd: string, execFileSyncImpl?: ExecFileSyncFn): string | null;
/**
 * Does this repository already use linked worktrees?
 *
 * `git worktree list --porcelain` emits one blank-line separated block per
 * worktree, the main checkout first. Counting `worktree ` lines is not enough:
 * a worktree whose directory has been deleted keeps its block — marked
 * `prunable` — until `git worktree prune` runs, so a repository that no longer
 * has any linked worktree would still report one.
 *
 * This deliberately does not try to predict a *future* `git worktree add`: there
 * is no signal for that, and guessing wrong in the permissive direction is what
 * made `agentteams init` write a shared hooks directory for every project.
 * `agentteams doctor --install-worktree-hook` installs the hook on demand, so a
 * wrong guess here costs one command.
 */
export declare function hasLinkedGitWorktrees(cwd: string, execFileSyncImpl?: ExecFileSyncFn): boolean;
/**
 * The single rule for "may the managed post-checkout hook be written to this
 * repository's shared hooks directory?".
 *
 * `init` and `doctor` both install that hook, and they must agree: when only
 * `init` gated the write, running `agentteams init` a second time took the
 * configured-project fast path, which calls `doctor`, which installed the hook
 * anyway — the gate existed but never held.
 */
export declare function shouldInstallWorktreeHook(cwd: string, options?: {
    force?: boolean;
}, execFileSyncImpl?: ExecFileSyncFn): boolean;
export declare function resolveGitTopLevel(cwd: string, execFileSyncImpl?: ExecFileSyncFn): string | null;
export {};
//# sourceMappingURL=git.d.ts.map