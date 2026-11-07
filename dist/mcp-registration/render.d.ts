import type { McpClientDefinition, McpEntryShape, McpScope, McpServerSpec } from './types.js';
/** Serialize the AgentTeams server entry in the shape the target client expects. */
export declare function buildEntryValue(shape: McpEntryShape, spec: McpServerSpec): Record<string, unknown>;
/**
 * The copy-pasteable config fragment for one client/scope. This is the escape
 * hatch every failure path points at, so it must be complete on its own: the
 * full container wrapper, not just the inner entry.
 */
export declare function renderConfigSnippet(client: McpClientDefinition, scope: McpScope, spec: McpServerSpec, serverName: string): string;
/** The equivalent vendor command, for users who prefer to run it themselves. */
export declare function renderVendorCommandLine(client: McpClientDefinition, scope: McpScope, spec: McpServerSpec, serverName: string): string | null;
/**
 * Strip AgentTeams key material from vendor output before it reaches a terminal or a log.
 *
 * Registration itself no longer holds a credential — the server spec embeds nothing — so
 * there is no value to pass in. What remains is that vendor CLIs echo their own argv and
 * environment on failure, and that output can carry a `key_` this process never saw.
 */
export declare function redactKeyMaterial(text: string): string;
//# sourceMappingURL=render.d.ts.map