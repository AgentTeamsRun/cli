import { type ResolveCredentialDeps } from '../utils/config.js';
/** Everything a tool handler needs to reach the AgentTeams API. */
export interface McpToolContext {
    apiUrl: string;
    projectId: string;
    /**
     * Credentials as of server start. For a long-lived agent key this is the whole
     * story; for a credential that expires it is only the first value.
     */
    headers: Record<string, string>;
    /**
     * Absolute root of the local checkout this session is bound to, when there is
     * one. Present only if a local `.agentteams/config.json` names the same project
     * the tools write to — an MCP server spawned from an arbitrary cwd may sit
     * outside the project, or inside a different one, and reading that project's
     * guides would hand the agent the wrong rules and the wrong `guideHash`.
     * Absent means "no verified local copy": guide reads fall back to the server.
     */
    projectRoot?: string;
    /**
     * Which agent config (tool) this MCP session runs as, when the daemon spawned it.
     *
     * The tool axis of attribution: with a personal token the request carries no proven
     * agent identity, so without this the record silently loses "what it was written
     * with". Absent outside a daemon-spawned session — write tools must then omit the
     * field entirely rather than send an empty value.
     */
    agentConfigId?: string;
    /**
     * Present only when the credential can go stale.
     *
     * `agentteams mcp` runs for hours while a personal access token lives 15
     * minutes, so resolving once at startup would make every later tool call 401.
     * Tool handlers must call this instead of reading {@link headers} directly.
     * It is cheap: the access token is cached in memory and only re-fetched inside
     * the refresh window, so the OS credential store is not touched per call.
     */
    resolveHeaders?: () => Promise<Record<string, string>>;
}
export declare const MCP_BINDING_SOURCE_ENV = "AGENTTEAMS_MCP_BINDING_SOURCE";
export type McpBindingSource = 'user' | 'explicit' | 'desktop';
export declare function assertMcpProjectBinding(input: {
    localProjectId?: string;
    boundProjectId: string;
    bindingSource: McpBindingSource;
}): void;
/**
 * Resolve credentials the same way every other command does.
 *
 * The MCP server is spawned by an external agent, so its cwd cannot be
 * trusted to sit inside the project: CLI overrides and `AGENTTEAMS_*`
 * environment variables are the reliable paths here.
 */
export declare function resolveMcpToolContext(options?: Record<string, unknown>, credentialDeps?: ResolveCredentialDeps): Promise<McpToolContext>;
//# sourceMappingURL=context.d.ts.map