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
const ENTITY_ID_PREFIX = /^agentteams_(?:pln|rpt|rev|act|cnv|pmt|doc|rvf|tsk)_/;

/**
 * Strip a known AgentTeams entity-id prefix from a value. Values without a
 * recognized prefix (bare ids, undefined, non-strings) are returned unchanged.
 */
export function stripEntityIdPrefix<T>(value: T): T {
  if (typeof value !== 'string') return value;
  return value.replace(ENTITY_ID_PREFIX, '') as unknown as T;
}

/**
 * Whether a CLI option key carries an entity id and should accept prefixed
 * input. We normalize the bare `id` flag plus every `*Id` option (e.g.
 * `planId`, `completionReportId`, `codeReviewId`, `sourcePlanId`,
 * `sourceCompletionReportId`). This matches the documented promise that any
 * `--id`/`--plan-id`/`--completion-report-id`/etc. value is normalized
 * automatically, instead of an allowlist that silently misses some flags.
 *
 * Non-AgentTeams id flags (`projectId`, `teamId`, `issueId`, ...) are safe to
 * pass through `stripEntityIdPrefix`: it only removes a leading canonical
 * `agentteams_<type>_` prefix, which those values never carry.
 */
function isEntityIdOptionKey(key: string): boolean {
  return key === 'id' || key.endsWith('Id');
}

/**
 * Return a shallow copy of CLI options with every entity-id-bearing option
 * normalized to its bare id. Non-id options are left untouched.
 */
export function normalizeEntityIdOptions(options: Record<string, unknown>): Record<string, unknown> {
  let mutated = false;
  const next: Record<string, unknown> = { ...options };
  for (const key of Object.keys(options)) {
    if (!isEntityIdOptionKey(key)) continue;
    const value = next[key];
    if (typeof value !== 'string') continue;
    const normalized = stripEntityIdPrefix(value);
    if (normalized !== value) {
      next[key] = normalized;
      mutated = true;
    }
  }
  return mutated ? next : options;
}
