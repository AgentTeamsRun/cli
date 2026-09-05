import type { ToolProfile } from '@agentteams/context-tools';
import type { McpPathContext, McpScope, McpServerSpec } from './types.js';
/** Server name registered in every client. Kept stable so re-runs update rather than duplicate. */
export declare const MCP_SERVER_NAME = "agentteams";
/** Published package the `npx` fallback runs. */
export declare const MCP_RUNTIME_PACKAGE = "@agentteams/cli";
/** Name of the globally installed executable, when there is one. */
export declare const MCP_GLOBAL_EXECUTABLE = "agentteams";
/**
 * Project identity for command context and human-readable output only.
 *
 * There is no credential field on purpose: the generated server spec embeds nothing,
 * and `agentteams mcp` resolves project config plus the stored login at request
 * time. Re-adding one here would put a secret back into a client config file.
 */
export interface McpCredentials {
    projectId: string;
    teamId: string;
    apiUrl: string;
}
export interface BuildServerSpecOptions {
    /** Absolute path to a local `cli/dist/index.js`; omit to use the published package. */
    serverEntry?: string;
    /**
     * Registration context. When present, the spec is chosen from what this machine can
     * actually spawn; when absent, the global executable is assumed.
     */
    context?: McpPathContext;
    /** Injection seam so tests drive a fake PATH instead of the developer's machine. */
    fileExists?: (path: string) => boolean;
    /** `full` stays implicit for compatibility; limited profiles are explicit argv. */
    toolProfile?: ToolProfile;
    /**
     * Which scope the spec is written into. `project` is repository state that gets
     * committed and read on other people's machines, so it never encodes what this
     * machine happens to have on PATH.
     */
    scope?: McpScope;
}
/** Is a bare `agentteams` resolvable from this context's PATH? */
export declare function hasGlobalExecutable(context: McpPathContext, fileExists?: (path: string) => boolean): boolean;
/**
 * What the client will spawn.
 *
 * A bare `agentteams` is the fast path, but it is only correct when the package is
 * installed globally *and* the client inherits a PATH that contains it — neither holds
 * for `npx @agentteams/cli mcp install` or for a GUI-launched client that never sourced
 * a login shell. Those failures surface as an opaque "server failed to start" inside the
 * client, so when the executable is not resolvable the spec falls back to `npx`, which
 * works in both cases.
 *
 * Project scope skips that choice entirely and always uses `npx`. A project config is
 * a file in the repository: whichever runtime this machine happens to have would be
 * committed and then read on machines where it is wrong, and the failure surfaces
 * inside the client as the same opaque "server failed to start". `npx` is the one
 * value that is true on every machine.
 */
export declare function buildServerSpec(options: BuildServerSpecOptions): McpServerSpec;
//# sourceMappingURL=serverSpec.d.ts.map