/**
 * Strip a known AgentTeams entity-id prefix from a value. Values without a
 * recognized prefix (bare ids, undefined, non-strings) are returned unchanged.
 */
export declare function stripEntityIdPrefix<T>(value: T): T;
/**
 * Return a shallow copy of CLI options with every entity-id-bearing option
 * normalized to its bare id. Non-id options are left untouched.
 */
export declare function normalizeEntityIdOptions(options: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=entityId.d.ts.map