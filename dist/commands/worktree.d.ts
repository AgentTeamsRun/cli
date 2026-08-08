import { spawn } from 'node:child_process';
import { type WorktreeLifecycleEvent } from '../api/worktree.js';
export declare const computeWorktreeLocalKey: (worktreePath: string) => string;
export declare const createDefaultWorktreeEventId: (event: WorktreeLifecycleEvent["event"]) => string;
export declare const waitForPathRemoval: (worktreePath: string, options?: {
    intervalMs?: number;
    timeoutMs?: number;
}) => Promise<boolean>;
type ScheduleDeletedEventDeps = {
    spawn?: typeof spawn;
    platform?: NodeJS.Platform;
    execPath?: string;
    entryPath?: string;
    env?: NodeJS.ProcessEnv;
};
export declare const scheduleDeletedEventAfterRemoval: (worktreePath: string, stableCwd: string, event: WorktreeLifecycleEvent, deps?: ScheduleDeletedEventDeps) => void;
export declare function executeWorktreeCommand(action: string, options: Record<string, unknown>): Promise<unknown>;
export {};
//# sourceMappingURL=worktree.d.ts.map