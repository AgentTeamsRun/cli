import { getUnionFreeToolProfiles, getUnionToolNames } from '../mcp/catalog.js';
/** Tools in `profile` that this client's backend would reject outright. */
function rejectedToolNames(client, profile) {
    if (client.schemaConstraint?.kind !== 'topLevelUnion')
        return [];
    return getUnionToolNames(profile);
}
function suggestFallback(client, requested) {
    const declared = client.schemaConstraint?.fallbackToolProfile;
    if (declared && rejectedToolNames(client, declared).length === 0)
        return declared;
    // The declared fallback stopped being safe (a union reached it, or a new
    // constraint kind was added). Pick from the live catalog rather than writing a
    // profile we already know this client cannot load.
    const usable = getUnionFreeToolProfiles();
    return usable[0] ?? requested;
}
/**
 * Which profile to register for one client.
 *
 * A `schemaConstraint` is a hard limit, not a preference: registering a profile
 * that contains a rejected tool reports INSTALLED and then breaks every
 * conversation in that client. So the default profile is narrowed to a usable
 * one and the change is always announced — silently registering a smaller
 * catalog would be its own surprise.
 *
 * An explicit `--tool-profile` is still honoured. The caller asked for a
 * specific catalog and may know something we do not (a fixed backend, a
 * different model); the notice tells them what will break if they do not.
 */
export function resolveClientToolProfile(client, requested, explicit) {
    const rejected = rejectedToolNames(client, requested);
    if (rejected.length === 0)
        return { toolProfile: requested };
    const constraintReason = client.schemaConstraint?.reason ?? 'This client cannot load part of the catalog.';
    const rejectedList = rejected.join(', ');
    if (explicit) {
        return {
            toolProfile: requested,
            notice: `Warning: the explicit --tool-profile ${requested} exposes ${rejectedList} to ${client.label}, which cannot load it. ${constraintReason} Re-run with --tool-profile ${suggestFallback(client, requested)} for a catalog this client accepts.`,
        };
    }
    const fallback = suggestFallback(client, requested);
    return {
        toolProfile: fallback,
        notice: `Tool profile narrowed to ${fallback} for ${client.label}: the ${requested} profile exposes ${rejectedList}, which this client cannot load. ${constraintReason} Pass --tool-profile ${requested} to register it anyway.`,
    };
}
/** Did the caller name a profile, or are we on the implicit `full` default? */
export function isExplicitToolProfile(value) {
    return typeof value === 'string' && value.length > 0;
}
//# sourceMappingURL=toolProfileSupport.js.map