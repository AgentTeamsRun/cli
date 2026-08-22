import type { ToolProfile } from '@agentteams/context-tools';
/** Client ids accepted by `--client`. Orca is not a client and GEMINI is a deprecated runner type, so neither appears here. */
export declare const MCP_CLIENT_IDS: readonly ["claude-code", "codex", "copilot-cli", "opencode", "amp", "cursor-cli", "kimi-cli", "antigravity", "kiro-cli", "grok-build"];
export type McpClientId = (typeof MCP_CLIENT_IDS)[number];
export type McpScope = 'user' | 'project';
export type McpNativeDiscoveryStatus = 'verified' | 'unsupported' | 'unknown';
export interface McpNativeDiscoveryCapability {
    status: McpNativeDiscoveryStatus;
    verifiedAt: string;
    evidenceUrl?: string;
    version?: string;
    reason?: string;
}
/**
 * A tool-schema shape this client's model backend cannot accept.
 *
 * This is not a preference — a rejected schema fails the request, so registering
 * a profile that contains such a tool leaves the client worse off than not
 * registering at all. The constraint names the *shape*, not a profile list, so
 * the profiles it rules out are derived from the live catalog: flattening the
 * offending schema lifts the restriction with no edit here.
 */
export interface McpSchemaConstraint {
    /** The backend rejects a tool whose input schema is a top-level union (`anyOf`). */
    kind: 'topLevelUnion';
    /** Profile registered instead when the requested one contains a rejected tool. */
    fallbackToolProfile: ToolProfile;
    /** User-facing explanation, printed whenever the constraint changes or contradicts the request. */
    reason: string;
}
/** How the AgentTeams entry reaches the client's configuration. */
export type McpInstallStrategy = 
/** The client owns the format; we shell out to its documented non-interactive command. */
'vendorCommand'
/** We own the merge: surgical JSONC upsert with backup and atomic rename. */
 | 'jsonMerge'
/** No automated path we can prove safe — `install` prints the snippet instead of writing. */
 | 'configOnly';
/** What the vendor command does when the server name is already registered. */
export type VendorRerunBehavior = 'update' | 'refuse';
/** Serialized shape of a single server entry in the client's config. */
export type McpEntryShape = 
/** `{ type: "stdio", command, args, env }` */
'stdio'
/** `{ command, args, env }` */
 | 'plain'
/** `{ type: "local", command: [...], environment, enabled }` */
 | 'opencode';
export interface McpPathContext {
    homeDir: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
}
export interface McpServerSpec {
    command: string;
    args: string[];
    env: Record<string, string>;
}
export interface VendorCommandPlan {
    executable: string;
    args: string[];
}
export interface McpScopeDefinition {
    /** Absolute path of the config file this scope writes to. */
    configPath: (context: McpPathContext) => string;
    format: 'json' | 'jsonc' | 'toml';
    /** Top-level key holding the server map. Absent for TOML. */
    containerKey?: string;
    entryShape?: McpEntryShape;
    strategy: McpInstallStrategy;
    /** Present when `strategy === 'vendorCommand'`. */
    vendor?: {
        buildArgs: (spec: McpServerSpec, serverName: string) => string[];
        rerunBehavior: VendorRerunBehavior;
        /** Patterns that mean "already registered", not "failed". */
        alreadyRegisteredPatterns?: RegExp[];
    };
    /** Present when `strategy === 'configOnly'`; explains why nothing is written. */
    configOnlyReason?: string;
}
export interface McpClientDefinition {
    id: McpClientId;
    /** RunnerType key in packages/core-constants. Enforced by a monorepo drift test. */
    runnerType: string;
    label: string;
    /** Executable names looked up on PATH. */
    executables: string[];
    /** Extra directories to probe when the client installs outside PATH (e.g. Kimi). */
    extraBinDirs?: (context: McpPathContext) => string[];
    /** Optional executable identity contract for command names shared with unrelated tools. */
    executableIdentity?: {
        args: string[];
        marker: string;
        /** Search managed install directories before PATH, while still checking every candidate. */
        preferExtraBinDirs?: boolean;
    };
    /** Files/directories whose presence proves the client has been configured on this machine. */
    configSignals: (context: McpPathContext) => string[];
    /** Official documentation for the config contract encoded above. */
    docsUrl: string;
    /** Date the contract above was verified against the vendor's docs and a local install. */
    verifiedAt: string;
    /** Native host-side progressive discovery; never changes the profile automatically. */
    nativeDiscovery: McpNativeDiscoveryCapability;
    /** Present only when the client's backend rejects part of the catalog outright. */
    schemaConstraint?: McpSchemaConstraint;
    scopes: Record<McpScope, McpScopeDefinition>;
}
export type InstallOutcome = 'INSTALLED' | 'ALREADY_REGISTERED' | 'SKIPPED_CONFIG_ONLY' | 'SKIPPED_NOT_DETECTED' | 'FAILED';
export interface InstallResult {
    clientId: McpClientId;
    scope: McpScope;
    outcome: InstallOutcome;
    strategy: McpInstallStrategy;
    /** The config file the outcome refers to. */
    configPath: string;
    /** Redacted, user-facing explanation. Never contains credentials. */
    detail: string;
    backupPath?: string;
    /** Manual fallback, always present for non-INSTALLED outcomes. */
    manualSnippet?: string;
    /** The profile actually written, which a `schemaConstraint` may have narrowed. */
    toolProfile?: ToolProfile;
    /** Why the written profile differs from (or contradicts) the requested one. */
    toolProfileNotice?: string;
}
export interface DetectionSignal {
    clientId: McpClientId;
    label: string;
    /** Why the client is considered present: config traces, an executable, or both. */
    evidence: 'configured' | 'executable' | 'both' | 'none';
    executablePath: string | null;
    configPaths: string[];
    detected: boolean;
}
//# sourceMappingURL=types.d.ts.map