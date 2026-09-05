import type { ToolProfile } from '@agentteams/context-tools';
import { McpServer } from '@modelcontextprotocol/server';
import { type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { type McpToolContext } from './context.js';
export declare const MCP_SERVER_NAME = "@agentteams/cli";
/**
 * Build one MCP server instance. `serveStdio` calls this per connection (and
 * per discarded `server/discover` probe), so it must stay side-effect free
 * apart from stderr diagnostics.
 *
 * This module is the only place allowed to import the MCP SDK or assemble MCP
 * response envelopes: domain handlers stay SDK-agnostic so upgrading the
 * pinned beta only touches this adapter.
 */
export declare function createMcpServer(context: McpToolContext, version?: string, toolProfile?: ToolProfile): McpServer;
/**
 * Start the stdio MCP server. stdout is reserved for JSON-RPC frames, so every
 * diagnostic goes to stderr.
 */
export declare function startMcpServer(options?: Record<string, unknown>): Promise<StdioServerHandle>;
//# sourceMappingURL=server.d.ts.map