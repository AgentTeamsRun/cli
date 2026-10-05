import { SEARCH_TOOL_NAME, type ContextToolsClient, type ContextToolSpec } from '@agentteams/context-tools';
import type { McpToolContext } from './context.js';
export { SEARCH_TOOL_NAME };
export type McpToolSpec = ContextToolSpec;
/**
 * Bind the transport-independent context-tool contract to the CLI's existing
 * authenticated HTTP functions. MCP envelopes remain in server.ts.
 */
export declare function createCliContextToolsClient(context: McpToolContext): ContextToolsClient;
/** Every tool the MCP server exposes, in registration order. */
export declare function getToolSpecs(): McpToolSpec[];
//# sourceMappingURL=tools.d.ts.map