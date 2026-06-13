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
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'ignore'];
    windowsHide?: boolean;
}) => string;
export declare function collectGitMetrics(execFileSyncImpl?: ExecFileSyncFn, options?: {
    startCommit?: string;
}): GitMetrics;
export {};
//# sourceMappingURL=git.d.ts.map