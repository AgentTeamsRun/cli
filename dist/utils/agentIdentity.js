import { toNonEmptyString } from './parsers.js';
/**
 * Environment variable every daemon runner sets to the agentConfigId of the
 * session it is spawning (`daemon/src/runners/*`).
 */
export const AGENT_NAME_ENV = 'AGENTTEAMS_AGENT_NAME';
/**
 * Which agent config (tool) this session runs as, when the daemon spawned it.
 *
 * This is the tool axis of attribution, orthogonal to who the actor is. The server
 * prefers the `agentConfigId` carried by an agent API key (`key_{configId}_{secret}`)
 * and ignores a declared value, because a proven identity must not be overridable by
 * the caller. It matters for credentials that carry no agent: a personal token
 * identifies a person, so without this the request has no agent at all and the record
 * silently loses its tool axis — a change in how you authenticate must not change what
 * gets recorded.
 *
 * Returns `undefined` outside a daemon-spawned session (desktop, manual runs). Callers
 * must then send nothing at all rather than an empty string or a placeholder.
 */
export function resolveSessionAgentConfigId(env = process.env) {
    return toNonEmptyString(env[AGENT_NAME_ENV]);
}
/**
 * Execution snapshot variables the daemon exports for every session it spawns
 * (`daemon/src/runners/session-env.ts`). They describe how *this* run is executing —
 * which engine, which model, whether fast mode is on — as opposed to who it runs as.
 *
 * The daemon omits a variable entirely when it has no value, so an absent variable
 * means "unknown", never "empty" or "false-by-default".
 */
export const RUNNER_TYPE_ENV = 'AGENTTEAMS_RUNNER_TYPE';
export const MODEL_ENV = 'AGENTTEAMS_MODEL';
export const FAST_MODE_ENV = 'AGENTTEAMS_FAST_MODE';
export function resolveSessionRunnerType(env = process.env) {
    return toNonEmptyString(env[RUNNER_TYPE_ENV]);
}
export function resolveSessionModel(env = process.env) {
    return toNonEmptyString(env[MODEL_ENV]);
}
/**
 * Fast mode is a two-state boolean flag on the CLI (`--fast`), not a tri-state, so an
 * absent variable simply reads as off. The daemon only exports it when fast mode is on.
 */
export function resolveSessionFastMode(env = process.env) {
    return toNonEmptyString(env[FAST_MODE_ENV]) === 'true';
}
/**
 * The execution snapshot for this run: an explicit argument always wins, and the session
 * environment fills the gap when the daemon spawned us.
 *
 * A resolved value can still be `undefined` — outside a daemon session nothing can tell us
 * the model. Callers that require the snapshot must keep failing in that case; this resolver
 * narrows *when* they fail, it does not relax the requirement.
 */
export function resolveExecutionSnapshot(options, env = process.env) {
    return {
        runnerType: toNonEmptyString(options.runnerType) ?? resolveSessionRunnerType(env),
        model: toNonEmptyString(options.model) ?? resolveSessionModel(env),
        fastMode: options.fast === true || resolveSessionFastMode(env),
    };
}
/**
 * Appended to the existing "required" errors so the message names the other way out. The
 * previous wording implied passing the flags was the only path, which is wrong inside a
 * runner session and sends agents looking for values the session already has.
 */
export const EXECUTION_SNAPSHOT_HINT = ' In a runner session these are filled in automatically from the environment.';
//# sourceMappingURL=agentIdentity.js.map