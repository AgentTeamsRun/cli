import type { ToolProfile } from '@agentteams/context-tools';
import { type DetectionDependencies } from './detect.js';
import { renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { type McpCredentials } from './serverSpec.js';
import type { DetectionSignal, InstallResult, McpClientDefinition, McpPathContext, McpScope } from './types.js';
import { type VendorRunner } from './vendorCommand.js';
export interface InstallClientOptions {
    client: McpClientDefinition;
    scope: McpScope;
    credentials: McpCredentials;
    context: McpPathContext;
    serverEntry?: string;
    serverName?: string;
    vendorRunner?: VendorRunner;
    toolProfile?: ToolProfile;
    /** True when `--tool-profile` was named; an implicit `full` may be narrowed by a schema constraint. */
    explicitToolProfile?: boolean;
}
/**
 * Apply (or explicitly decline to apply) the AgentTeams entry for one client/scope.
 *
 * The profile is resolved here rather than at the command layer so every caller —
 * single install, batch install, and the snippets rendered from either — writes
 * the same catalog a client can actually load.
 */
export declare function installClient(options: InstallClientOptions): InstallResult;
export interface BatchPlanEntry {
    clientId: McpClientDefinition['id'];
    label: string;
    evidence: DetectionSignal['evidence'];
    executablePath: string | null;
    configPaths: string[];
    scope: McpScope;
    strategy: McpClientDefinition['scopes'][McpScope]['strategy'];
    targetPath: string;
    applicable: boolean;
    reason?: string;
}
export interface BatchPlan {
    scope: McpScope;
    entries: BatchPlanEntry[];
    /** A single user-scope registration binds the client to one AgentTeams project. */
    binding: {
        projectId: string;
        teamId: string;
    };
}
export interface BuildBatchPlanOptions {
    context: McpPathContext;
    credentials: McpCredentials;
    scope?: McpScope;
    detection?: DetectionSignal[];
    detectionDependencies?: Omit<DetectionDependencies, 'context'>;
}
/**
 * Detection plan for the no-argument `install`. Nothing here touches the
 * filesystem — the caller prints it and stops unless `--yes` was passed.
 */
export declare function buildBatchPlan(options: BuildBatchPlanOptions): BatchPlan;
export interface RunBatchInstallOptions extends BuildBatchPlanOptions {
    serverEntry?: string;
    serverName?: string;
    vendorRunner?: VendorRunner;
    toolProfile?: ToolProfile;
    explicitToolProfile?: boolean;
}
/**
 * Apply the plan client by client. One client's failure must not strand the
 * rest, so every entry is attempted and the caller derives the exit code from
 * the collected outcomes.
 */
export declare function runBatchInstall(options: RunBatchInstallOptions): {
    plan: BatchPlan;
    results: InstallResult[];
};
/** Non-zero exit only for real failures; "config only" and "not detected" are expected states. */
export declare function resolveInstallExitCode(results: InstallResult[]): number;
export { renderConfigSnippet, renderVendorCommandLine };
//# sourceMappingURL=install.d.ts.map