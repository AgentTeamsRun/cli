import { buildToolCatalog, getToolNamesForProfile, TOOL_PROFILES, } from '@agentteams/context-tools';
import { z } from 'zod';
import { getLocalToolSpecs } from './localTools.js';
import { getToolSpecs } from './tools.js';
import { getWriteToolSpecs } from './writeTools.js';
/** Build and validate the complete catalog before selecting one public profile. */
export function getProfileToolSpecs(profile) {
    const readTools = getToolSpecs();
    const localTools = getLocalToolSpecs();
    const writeTools = getWriteToolSpecs();
    const catalog = buildToolCatalog([
        { kind: 'read', specs: readTools },
        { kind: 'read', specs: localTools },
        { kind: 'write', specs: writeTools },
    ]);
    const includedNames = new Set(getToolNamesForProfile(catalog, profile));
    return {
        readTools: readTools.filter(({ name }) => includedNames.has(name)),
        localTools: localTools.filter(({ name }) => includedNames.has(name)),
        writeTools: writeTools.filter(({ name }) => includedNames.has(name)),
    };
}
/** Whether a JSON Schema contains an `anyOf`/`oneOf` union at any depth. */
export function containsUnionSchema(schema, seen = new Set()) {
    if (typeof schema !== 'object' || schema === null)
        return false;
    if (seen.has(schema))
        return false;
    seen.add(schema);
    if (Array.isArray(schema)) {
        return schema.some((item) => containsUnionSchema(item, seen));
    }
    const node = schema;
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf))
        return true;
    return Object.values(node).some((value) => containsUnionSchema(value, seen));
}
/**
 * Names of the exposed tools whose input schema contains a union.
 *
 * Some model backends (Kiro's Bedrock, verified 2.16.2) reject such a tool with a
 * 400 that fails the whole request, so registration needs to know which profiles
 * contain one. Derived from the live catalog rather than a hand-kept list: when
 * a union is flattened the answer changes on its own.
 */
export function getUnionToolNames(profile) {
    const { readTools, localTools, writeTools } = getProfileToolSpecs(profile);
    return [...readTools, ...localTools, ...writeTools]
        .filter((spec) => containsUnionSchema(z.toJSONSchema(spec.inputSchema)))
        .map(({ name }) => name);
}
/** Profiles whose catalog is free of union input schemas, in declaration order. */
export function getUnionFreeToolProfiles() {
    return TOOL_PROFILES.filter((profile) => getUnionToolNames(profile).length === 0);
}
//# sourceMappingURL=catalog.js.map