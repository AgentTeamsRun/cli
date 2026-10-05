import type { ToolProfile } from '@agentteams/context-tools';
import type { McpClientDefinition } from './types.js';
export interface ResolvedClientToolProfile {
    /** Profile that should actually be written for this client. */
    toolProfile: ToolProfile;
    /** Present only when the constraint changed the profile or contradicts an explicit request. */
    notice?: string;
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
export declare function resolveClientToolProfile(client: McpClientDefinition, requested: ToolProfile, explicit: boolean): ResolvedClientToolProfile;
/** Did the caller name a profile, or are we on the implicit `full` default? */
export declare function isExplicitToolProfile(value: unknown): boolean;
//# sourceMappingURL=toolProfileSupport.d.ts.map