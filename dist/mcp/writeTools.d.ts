import { type McpLocalToolSpec } from './localTools.js';
/**
 * MCP **write** tools. CLI-only on purpose.
 *
 * These are deliberately *not* added to `@agentteams/context-tools`:
 * `desktop/src/main/localAgent/directRunner.ts` advertises every context-tool
 * definition to the model without filtering, so a write tool placed there would
 * be handed to Direct BYOK conversations — the exact `DESKTOP_LIMITED` boundary
 * that must not grant blanket project write access.
 *
 * The spec shape is the CLI-local one declared in `localTools.ts`, so the shared
 * read package stays read-only. No MCP SDK import belongs here — `server.ts` is
 * the only adapter (see `test/mcp-boundary.test.ts`).
 */
export type McpWriteToolSpec = McpLocalToolSpec;
/** Every write tool the CLI MCP server exposes, in registration order. */
export declare function getWriteToolSpecs(): McpWriteToolSpec[];
//# sourceMappingURL=writeTools.d.ts.map