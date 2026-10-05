import { type ContextToolSpec, type ToolProfile } from '@agentteams/context-tools';
import { type McpLocalToolSpec } from './localTools.js';
import { type McpWriteToolSpec } from './writeTools.js';
export interface ProfileToolSpecs {
    readTools: ContextToolSpec[];
    /** CLI-local, non-write tools. Catalogued as `read`, but handed the tool context. */
    localTools: McpLocalToolSpec[];
    writeTools: McpWriteToolSpec[];
}
/** Build and validate the complete catalog before selecting one public profile. */
export declare function getProfileToolSpecs(profile: ToolProfile): ProfileToolSpecs;
/** Whether a JSON Schema contains an `anyOf`/`oneOf` union at any depth. */
export declare function containsUnionSchema(schema: unknown, seen?: Set<object>): boolean;
/**
 * Names of the exposed tools whose input schema contains a union.
 *
 * Some model backends (Kiro's Bedrock, verified 2.16.2) reject such a tool with a
 * 400 that fails the whole request, so registration needs to know which profiles
 * contain one. Derived from the live catalog rather than a hand-kept list: when
 * a union is flattened the answer changes on its own.
 */
export declare function getUnionToolNames(profile: ToolProfile): string[];
/** Profiles whose catalog is free of union input schemas, in declaration order. */
export declare function getUnionFreeToolProfiles(): ToolProfile[];
//# sourceMappingURL=catalog.d.ts.map