/**
 * AgentTeams web UI entity references embed a type prefix in the id
 * (e.g. `agentteams_pln_<uuid>`). The CLI and API only accept the bare id,
 * so any id pasted from an entity reference must be normalized before use.
 *
 * Canonical prefixes (see `.agentteams/convention.md`):
 *   agentteams_pln_ (plan) · agentteams_rpt_ (completionReport)
 *   agentteams_rev_ (codeReview) · agentteams_act_ (coAction)
 *   agentteams_cnv_ (convention) · agentteams_pmt_ (postMortem)
 *   agentteams_doc_ (document) · agentteams_rvf_ (codeReviewFinding)
 *   agentteams_tsk_ (planTask)
 */
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