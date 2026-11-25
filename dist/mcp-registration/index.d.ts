import { type DetectionDependencies } from './detect.js';
import { type BatchPlan } from './install.js';
import { type McpCredentials } from './serverSpec.js';
import type { InstallResult, McpPathContext, McpScope } from './types.js';
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
declare const MCP_CLIENT_ID_LIST: ("claude-code" | "codex" | "copilot-cli" | "opencode" | "amp" | "cursor-cli" | "kimi-cli" | "antigravity" | "kiro-cli" | "grok-build" | "omp" | "muse")[];
export { MCP_CLIENT_ID_LIST };
export interface McpRegistrationCommandOptions {
    client?: string;
    scope?: string;
    serverEntry?: string;
    /** Preview only: build the detection plan and touch nothing. */
    dryRun?: boolean;
    yes?: boolean;
    /**
     * Machine-readable output. A programmatic caller cannot see or answer a prompt, so
     * this also keeps the batch install behind an explicit `--yes` (see
     * `runMcpInstallCommand`).
     */
    json?: boolean;
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
export interface McpBatchInstallResult {
    scope: McpScope;
    plan: BatchPlan;
    results: InstallResult[];
    summary: {
        applied: number;
        skipped: number;
        failed: number;
    };
    exitCode: number;
}
/**
 * What the batch path actually reads.
 *
 * `client`, `dryRun`, `yes` and `json` are deliberately absent: they select *whether*
 * the batch runs, and `runMcpInstallCommand` resolves them before it gets here.
 * Accepting them would let a caller pass `dryRun: true` and still have files written.
 */
export type McpBatchInstallOptions = Omit<McpRegistrationCommandOptions, 'client' | 'dryRun' | 'yes' | 'json'>;
/**
 * Detect the local clients and register AgentTeams with every one this scope can
 * apply automatically. This always applies — there is no preview mode here.
 *
 * Exported so `agentteams init --mcp` reuses the exact command path instead of
 * re-deriving detection and strategy rules on its own.
 */
export declare function applyMcpBatchInstall(options: McpBatchInstallOptions, dependencies?: McpRegistrationDependencies): McpBatchInstallResult;
/**
 * `install` applies what it detects:
 *  - `--client <id>`: apply that one client at the selected scope.
 *  - no `--client`, project scope (the default): apply every detected client whose
 *    project scope has a safe automated path. Project files are repository state the
 *    caller already owns, so no extra approval is asked for.
 *  - no `--client`, `--scope user`: machine-wide client configs, so the plan is only
 *    printed until `--yes` approves it.
 *  - no `--client`, `--json`: the plan is printed until `--yes` approves it, whatever
 *    the scope. JSON output means another program is driving this, and the desktop
 *    app has shipped versions that call the project-scope argv expecting a preview.
 *  - `--dry-run`: preview at any scope. No file is written and no registration command
 *    is run; detection may still run a client's own `--help` to confirm its identity.
 */
export declare function runMcpInstallCommand(options: McpRegistrationCommandOptions, dependencies?: McpRegistrationDependencies): CommandOutput;
//# sourceMappingURL=index.d.ts.map