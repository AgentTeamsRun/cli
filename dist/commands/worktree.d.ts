import { type WorktreeLifecycleEvent } from '../api/worktree.js';
export declare const computeWorktreeLocalKey: (worktreePath: string) => string;
export declare const createDefaultWorktreeEventId: (event: WorktreeLifecycleEvent["event"]) => string;
export declare const waitForPathRemoval: (worktreePath: string, options?: {
    intervalMs?: number;
    timeoutMs?: number;
}) => Promise<boolean>;
export declare function executeWorktreeCommand(action: string, options: Record<string, unknown>): Promise<unknown>;
//# sourceMappingURL=worktree.d.ts.map