import { type ToolDiscoveryMetadata } from '@agentteams/context-tools';
import { z } from 'zod';
import type { McpToolContext } from './context.js';
/**
 * MCP tools that are **CLI-local** rather than shared.
 *
 * Two different reasons land a tool here, and both are about what the shared
 * `@agentteams/context-tools` package may advertise:
 *
 * - `agentteams_guide_get` reads a guide from the *local* checkout, so it only
 *   means anything in a process that sits in the project.
 * - `agentteams_resolve` reaches endpoints the shared `ContextToolsClient`
 *   contract does not expose (plan tasks, and Linear — which is not even
 *   project-scoped), so putting it in the package would mean widening that
 *   contract for every consumer.
 *
 * Write tools live next door in `writeTools.ts` for a third, stricter reason
 * (see the boundary note there). The spec shape below is shared by both files:
 * `handler(args, context)` receives the {@link McpToolContext}, unlike shared
 * read specs which receive a `ContextToolsClient`. No MCP SDK import belongs
 * here — `server.ts` is the only adapter (see `test/mcp-boundary.test.ts`).
 */
export interface McpLocalToolSpec {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodType<Record<string, unknown>>;
    discovery: ToolDiscoveryMetadata;
    handler(args: Record<string, unknown>, context: McpToolContext): Promise<unknown>;
}
/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
export declare const resolveToolHeaders: (context: McpToolContext) => Promise<Record<string, string>>;
/**
 * How a resolved reference comes back over MCP.
 *
 * Deliberately narrower than the CLI command's `ResolveResult`: there is no
 * `file` kind and no `filePath` for body-bearing entities. The command can
 * download a plan to disk because it runs in the project; an MCP server is
 * spawned by an arbitrary client with no cwd or filesystem contract, so the body
 * is inlined through the existing read tool instead. `localFile` survives —
 * there the path is *carried by the reference itself*, not produced by us — and
 * it is anchored to `projectRoot` whenever this session has one.
 */
export interface McpResolveResult {
    message: string;
    kind: 'record' | 'localFile' | 'external';
    refType: string;
    id: string;
    parentId?: string;
    /** Project-root-relative path carried by a `convention:id:path` reference. */
    path?: string;
    /**
     * The same path anchored to {@link McpToolContext.projectRoot}. Absent when
     * this session has no verified local checkout — then `path` is all we can
     * honestly say, and the agent has to supply its own base.
     */
    filePath?: string;
    url?: string;
    suggestedCommand?: string;
    fallbackCommand: string;
    record?: unknown;
}
/** Every CLI-local non-write tool the MCP server exposes, in registration order. */
export declare function getLocalToolSpecs(): McpLocalToolSpec[];
//# sourceMappingURL=localTools.d.ts.map