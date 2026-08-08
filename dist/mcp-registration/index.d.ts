import type { DetectionDependencies } from './detect.js';
import { type McpCredentials } from './serverSpec.js';
import type { McpPathContext } from './types.js';
import type { VendorRunner } from './vendorCommand.js';
export { MCP_CLIENTS, findClient, listClientIds } from './clients.js';
export { detectClients } from './detect.js';
export { runMcpDoctorCommand } from './doctor.js';
export type { McpDoctorCleanup, McpDoctorCommandOptions, McpDoctorCommandOutput, McpDoctorDependencies, McpDoctorFinding, McpDoctorReport, } from './doctor.js';
export { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall } from './install.js';
export { isExplicitToolProfile, resolveClientToolProfile } from './toolProfileSupport.js';
export type { ResolvedClientToolProfile } from './toolProfileSupport.js';
export { renderConfigSnippet, renderVendorCommandLine, redactKeyMaterial } from './render.js';
export { buildServerSpec, MCP_SERVER_NAME } from './serverSpec.js';
export type { McpCredentials } from './serverSpec.js';
export * from './types.js';
declare const MCP_CLIENT_ID_LIST: ("claude-code" | "codex" | "copilot-cli" | "opencode" | "amp" | "cursor-cli" | "kimi-cli" | "antigravity" | "kiro-cli")[];
export { MCP_CLIENT_ID_LIST };
export interface McpRegistrationCommandOptions {
    client?: string;
    scope?: string;
    serverEntry?: string;
    yes?: boolean;
    apiKey?: string;
    apiUrl?: string;
    projectId?: string;
    teamId?: string;
    toolProfile?: string;
}
/** Injection seams so tests drive a temporary HOME/cwd and a fake vendor CLI. */
export interface McpRegistrationDependencies {
    context?: Partial<McpPathContext>;
    credentials?: McpCredentials;
    vendorRunner?: VendorRunner;
    detectionDependencies?: Omit<DetectionDependencies, 'context'>;
}
export interface CommandOutput {
    text: string;
    json: unknown;
    exitCode: number;
}
/**
 * `config` is the escape hatch: it renders the exact fragment each client
 * expects and never touches a file, a vendor CLI or the network. The spawned
 * server resolves local project identity and credentials for itself, so the
 * fragment is safe to paste without any environment values.
 */
export declare function runMcpConfigCommand(options: McpRegistrationCommandOptions, dependencies?: McpRegistrationDependencies): CommandOutput;
/**
 * `install` has two modes:
 *  - `--client <id>`: apply a single client/scope (project scope allowed here).
 *  - no `--client`: detect local clients and print the plan. Only `--yes` turns
 *    that plan into writes, and only at user scope.
 */
export declare function runMcpInstallCommand(options: McpRegistrationCommandOptions, dependencies?: McpRegistrationDependencies): CommandOutput;
//# sourceMappingURL=index.d.ts.map