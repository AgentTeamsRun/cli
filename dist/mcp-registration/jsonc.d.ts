/**
 * Minimal JSONC reader plus a surgical single-entry editor.
 *
 * MCP client config files are user-owned: OpenCode ships `opencode.jsonc`, and
 * Cursor/Antigravity/Kimi users routinely keep comments and a hand-picked key
 * order in their `mcp.json`. A `JSON.parse` → `JSON.stringify` round-trip would
 * silently delete those comments and reorder everything, so writes are done as
 * a text splice that touches only the AgentTeams entry and leaves every other
 * byte of the document exactly where it was.
 */
export declare class McpConfigParseError extends Error {
    constructor(message: string);
}
/**
 * Parse JSON with comments and trailing commas. Returns `undefined` for an
 * empty document — an untouched client config file is frequently zero bytes,
 * and that is a "create it" signal rather than a corruption signal.
 */
export declare function parseJsonc(text: string): unknown;
export interface UpsertContainerEntryOptions {
    /** Top-level key holding the server map, e.g. `mcpServers`, `mcp`, `amp.mcpServers`. */
    containerKey: string;
    entryKey: string;
    entryValue: unknown;
}
export interface UpsertContainerEntryResult {
    text: string;
    /** The entry was already present before this edit. */
    existed: boolean;
    /** The entry was already present *and* byte-identical, so nothing was rewritten. */
    unchanged: boolean;
}
/**
 * Insert or replace `containerKey.entryKey` in a JSON/JSONC document without
 * reformatting anything else.
 *
 * @throws {McpConfigParseError} when the document is not parseable, or when the
 * root / container is not an object. Callers must treat this as "leave the
 * user's file untouched" rather than as permission to overwrite it.
 */
export declare function upsertContainerEntry(source: string, options: UpsertContainerEntryOptions): UpsertContainerEntryResult;
export interface EnsureRootMemberResult {
    text: string;
    /** The key was already present; its value is returned untouched in `existing`. */
    existed: boolean;
    existing?: unknown;
}
/**
 * Add a root-level scalar member when it is missing, without reformatting anything
 * else. An existing member is never rewritten — callers decide whether its value is
 * acceptable. Native settings files (Muse `schema_version`) need this so a file the
 * client created without the marker can still be registered into instead of rejected.
 *
 * @throws {McpConfigParseError} when the document is not parseable or the root is
 * not an object.
 */
export declare function ensureRootMember(source: string, key: string, value: string | number | boolean): EnsureRootMemberResult;
/** Read `containerKey.entryKey` from a parsed document, if present. */
export declare function readContainerEntry(source: string, containerKey: string, entryKey: string): unknown;
//# sourceMappingURL=jsonc.d.ts.map