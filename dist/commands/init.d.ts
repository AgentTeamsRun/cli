import { type ConventionStatusResult } from './convention.js';
import { type DoctorResult } from './doctor.js';
import type { AuthMode, Config } from '../types/index.js';
import { type WorktreeInitResult } from './initWorktree.js';
import type { InstallOutcome, McpRegistrationDependencies } from '../mcp-registration/index.js';
import { type EnsurePostCheckoutHookResult } from '../utils/conventionLink.js';
export { bootstrapLinkedWorktree } from './initWorktree.js';
export type { WorktreeEntryPointEntry, WorktreeEntryPointState, WorktreeInitResult } from './initWorktree.js';
type InitOptions = {
    cwd?: string;
    /** Personal login is the default; `api-key` is the explicit compatibility path. */
    authMode?: AuthMode;
    /**
     * Raw `--agent-files` value. Absent means "decide from detection, or from the
     * prompt when `--interactive` asked for it"; `none` means "create nothing" —
     * the two are different answers, so this stays a string rather than a
     * pre-parsed list.
     */
    agentFiles?: unknown;
    /** Restore the legacy `<name>-example` write when an entry point already exists. */
    agentFilesExample?: boolean;
    /**
     * Opt-in to the entry point multiselect. Absent means init asks nothing and
     * applies detection — see `resolveAgentFileSelection` for why the prompt is no
     * longer the default.
     */
    interactive?: boolean;
    /** Install the managed post-checkout hook even without a linked worktree. */
    installWorktreeHook?: boolean;
    /**
     * Explicit opt-in to the RFC 8628 device-code flow — no loopback port, approval
     * happens on another device. Same flag name as `agentteams auth login`.
     * Nothing detects the environment; only this flag (or the machine-wide default
     * the user declared) selects it.
     */
    deviceAuth?: boolean;
    /** Persist the device-code flow as this machine's default in `~/.agentteams/config.json`. */
    setDefault?: boolean;
    /**
     * Opt-in: register AgentTeams with the MCP clients detected for this project.
     * Absent means init writes no client configuration at all.
     */
    mcp?: boolean;
    /** Injection seam so tests drive a temporary HOME/PATH and a fake vendor CLI. */
    mcpDependencies?: McpRegistrationDependencies;
};
/** One client's registration outcome, as reported by `agentteams mcp install`. */
export type InitMcpClientOutcome = {
    clientId: string;
    outcome: InstallOutcome;
    detail: string;
    configPath: string;
    manualSnippet?: string;
};
/**
 * What `--mcp` did. Present only when the flag was passed, so its absence is the
 * proof that a plain `agentteams init` touched no client configuration.
 */
export type InitMcpResult = {
    scope: 'project';
    summary: {
        applied: number;
        skipped: number;
        failed: number;
    };
    clients: InitMcpClientOutcome[];
    /** Set when the batch could not run at all. Init itself still succeeds. */
    error?: string;
};
export type InitReadinessStatus = 'READY' | 'DEGRADED' | 'SKIPPED';
export type InitReadinessStage = 'project-binding' | 'credential' | 'convention-sync' | 'local-adapters';
export type InitReadinessIssue = {
    code: string;
    message: string;
};
export type InitReadinessStep = {
    stage: InitReadinessStage;
    status: InitReadinessStatus;
    issues: InitReadinessIssue[];
    retryCommand?: string;
};
/**
 * The local adapters init runs *after* the project binding and the credential
 * are already on disk. They are reported one by one because they fail
 * independently and each has its own repair command — collapsing them into a
 * single verdict is what used to turn one unwritable file into
 * "Initialization failed".
 */
export type InitAdapterName = 'gitignore' | 'agent-entry-points' | 'gemini-ignore' | 'post-checkout-hook';
export type InitAdapterOutcome = {
    adapter: InitAdapterName;
    status: InitReadinessStatus;
    issues: InitReadinessIssue[];
    retryCommand?: string;
};
export type AgentFileEntry = {
    relativePath: string;
    type: 'created' | 'example' | 'skipped' | 'upgraded';
};
/** One entry point path that could not be written, and why. */
export type AgentEntryPointWriteFailure = {
    relativePath: string;
    message: string;
};
export type AgentEntryPointWriteResult = {
    entries: AgentFileEntry[];
    failures: AgentEntryPointWriteFailure[];
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
    authMode: AuthMode;
    /** Set only on the personal-token path, where the credential lives outside the repository. */
    personalLogin?: {
        email: string;
        nickname: string;
        persisted: boolean;
        storeBackend?: string;
    };
    warning?: string;
    readiness: InitReadinessStep[];
    /** Per-adapter detail behind the `local-adapters` readiness step. Additive. */
    localAdapters: InitAdapterOutcome[];
    /** Present only when `--mcp` was passed. Additive. */
    mcp?: InitMcpResult;
};
export type ConfiguredProjectInitResult = {
    success: true;
    mode: 'configured-project';
    configPath: string;
    conventionPath: string;
    teamId: string;
    projectId: string;
    authMode: AuthMode;
    credentialSource: 'explicit-api-key' | 'personal-token' | 'config-api-key';
    conventionsUpdated: boolean;
    conventionStatus?: ConventionStatusResult;
    conventionError?: string;
    doctor: DoctorResult;
    readiness: InitReadinessStep[];
    /** Entry points this run wrote or left alone. Additive; the fast path repairs them too. */
    agentFiles: AgentFileEntry[];
    /** Per-adapter detail behind the `local-adapters` readiness step. Additive. */
    localAdapters: InitAdapterOutcome[];
    postCheckoutHook?: EnsurePostCheckoutHookResult;
    /** Present only when `--mcp` was passed. Additive. */
    mcp?: InitMcpResult;
};
type InitResult = OAuthInitResult | WorktreeInitResult | ConfiguredProjectInitResult;
export type InitExecutionKind = 'linked-worktree' | 'configured-project' | 'new-project';
export type InitExecutionContext = {
    kind: InitExecutionKind;
    configPath: string | null;
    config: Partial<Config> | null;
};
export declare function detectOsType(): 'MACOS' | 'LINUX' | 'WINDOWS' | undefined;
export type AuthorizeUrlInput = {
    port: number;
    projectName: string;
    authPathEnc?: string;
    osType?: string;
    state?: string;
    machineId?: string;
    /**
     * Present only on the unified setup path. It is what asks the web page to
     * finish selection *and* the personal-token consent on one screen; a web build
     * that does not know `flow=setup` simply ignores both parameters, which is why
     * the `--auth api-key` path must keep omitting them.
     */
    codeChallenge?: string;
};
export declare function buildAuthorizeUrl(input: AuthorizeUrlInput): string;
/**
 * Classify init before it opens a browser or materializes any local adapters.
 *
 * This resolver is intentionally read-only: the linked-worktree branch calls
 * `bootstrapLinkedWorktree` and the configured-project branch resolves its
 * credential only after classification, so a classification never touches a
 * keychain, a token, or the filesystem.
 *
 * `userHomeDir` is injectable for the same reason as in
 * `getConfigurationNotFoundMessage`: `os.homedir()` does not follow a test's
 * `process.env.HOME`, so the global-config rule would be untestable otherwise.
 */
export declare function detectInitExecutionContext(cwd: string, explicitAuthMode?: AuthMode, userHomeDir?: string): InitExecutionContext;
export declare function executeInitCommand(options?: InitOptions): Promise<InitResult>;
//# sourceMappingURL=init.d.ts.map