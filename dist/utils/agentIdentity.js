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
//# sourceMappingURL=agentIdentity.js.map