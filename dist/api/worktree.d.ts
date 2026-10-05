export type WorktreeLifecycleEvent = {
    event: 'CREATED' | 'DELETED';
    eventId: string;
    occurredAt: string;
    repositoryId?: string;
    remoteUrl?: string;
    localKey: string;
    branch?: string | null;
    headSha?: string | null;
    displayName?: string | null;
};
export declare function sendWorktreeLifecycleEvent(apiUrl: string, headers: Record<string, string>, event: WorktreeLifecycleEvent): Promise<unknown>;
//# sourceMappingURL=worktree.d.ts.map