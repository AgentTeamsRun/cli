import { type ConventionEntryPointState, type ConventionIssue } from '../utils/conventionLink.js';
export type WorktreeEntryPointState = ConventionEntryPointState;
export type WorktreeEntryPointEntry = {
    relativePath: string;
    state: WorktreeEntryPointState;
};
export type WorktreeInitResult = {
    success: true;
    mode: 'worktree';
    worktreePath: string;
    sourcePath: string;
    targetPath: string;
    materialization: 'symlink' | 'copy' | 'relinked' | 'existing' | 'blocked';
    entryPoints: WorktreeEntryPointEntry[];
    issues: ConventionIssue[];
    warning?: string;
};
/**
 * The one precondition set that says "this directory is a linked worktree whose
 * main checkout is already configured".
 *
 * `bootstrapLinkedWorktree` and the read-only classifier both need this answer,
 * and a copy in each would let them drift: the classifier reporting
 * `linked-worktree` while the bootstrap returns null drops init into the full
 * browser OAuth flow with no warning.
 */
export declare function resolveLinkedWorktreeSource(cwd: string): {
    worktreePath: string;
    sourcePath: string;
} | null;
export declare function bootstrapLinkedWorktree(cwd: string): WorktreeInitResult | null;
//# sourceMappingURL=initWorktree.d.ts.map