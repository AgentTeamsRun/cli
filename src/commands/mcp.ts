/**
 * Command-layer entry for `agentteams mcp`.
 *
 * The implementation lives in `cli/src/mcp/`: `context.ts` (credential
 * resolution), `tools.ts` (SDK-agnostic tool specs) and `server.ts` (the only
 * module allowed to import the MCP SDK). This file re-exposes the public
 * surface so the commander action — and existing importers — never touch the
 * SDK boundary directly.
 */
export { resolveMcpToolContext, type McpToolContext } from '../mcp/context.js';
export { SEARCH_TOOL_NAME } from '../mcp/tools.js';
export { MCP_SERVER_NAME, createMcpServer, startMcpServer } from '../mcp/server.js';
