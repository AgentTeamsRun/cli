import { type ConventionEntryPointState, type ConventionIssue, type EnsurePostCheckoutHookResult } from '../utils/conventionLink.js';
type InitOptions = {
    cwd?: string;
};
export type AgentFileEntry = {
    relativePath: string;
    type: 'created' | 'example';
};
type OAuthInitResult = {
    success: true;
    authUrl: string;
    configPath: string;
    conventionPath: string;
    teamId: string;
    projectId: string;
    agentName: string;
    agentFiles: AgentFileEntry[];
    seedPlanId: string | null;
    seedPlanWebUrl: string | null;
    postCheckoutHook?: EnsurePostCheckoutHookResult;
};
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
    materialization: 'symlink' | 'copy' | 'existing' | 'blocked';
    entryPoints: WorktreeEntryPointEntry[];
    issues: ConventionIssue[];
    warning?: string;
};
type InitResult = OAuthInitResult | WorktreeInitResult;
export declare function detectOsType(): 'MACOS' | 'LINUX' | 'WINDOWS' | undefined;
export declare function buildAuthorizeUrl(port: number, projectName: string, authPathEnc?: string, osType?: string): string;
export declare function bootstrapLinkedWorktree(cwd: string): WorktreeInitResult | null;
export declare function executeInitCommand(options?: InitOptions): Promise<InitResult>;
export {};
//# sourceMappingURL=init.d.ts.map