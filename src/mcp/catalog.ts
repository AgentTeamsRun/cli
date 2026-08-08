import {
  buildToolCatalog,
  getToolNamesForProfile,
  TOOL_PROFILES,
  type ContextToolSpec,
  type ToolProfile,
} from '@agentteams/context-tools';
import { z } from 'zod';
import { getLocalToolSpecs, type McpLocalToolSpec } from './localTools.js';
import { getToolSpecs } from './tools.js';
import { getWriteToolSpecs, type McpWriteToolSpec } from './writeTools.js';

export interface ProfileToolSpecs {
  readTools: ContextToolSpec[];
  /** CLI-local, non-write tools. Catalogued as `read`, but handed the tool context. */
  localTools: McpLocalToolSpec[];
  writeTools: McpWriteToolSpec[];
}

/** Build and validate the complete catalog before selecting one public profile. */
export function getProfileToolSpecs(profile: ToolProfile): ProfileToolSpecs {
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

/** A JSON Schema whose root is a union — `anyOf`/`oneOf` instead of an object. */
function isTopLevelUnionSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const root = schema as Record<string, unknown>;
  return Array.isArray(root.anyOf) || Array.isArray(root.oneOf);
}

/**
 * Names of the exposed tools whose input schema is a top-level union.
 *
 * Some model backends (Kiro's Bedrock, verified 2.16.2) reject such a tool with a
 * 400 that fails the whole request, so registration needs to know which profiles
 * contain one. Derived from the live catalog rather than a hand-kept list: when
 * a union is flattened the answer changes on its own.
 */
export function getTopLevelUnionToolNames(profile: ToolProfile): string[] {
  const { readTools, localTools, writeTools } = getProfileToolSpecs(profile);
  return [...readTools, ...localTools, ...writeTools]
    .filter((spec) => isTopLevelUnionSchema(z.toJSONSchema(spec.inputSchema)))
    .map(({ name }) => name);
}

/** Profiles whose catalog is free of top-level union input schemas, in declaration order. */
export function getUnionFreeToolProfiles(): ToolProfile[] {
  return TOOL_PROFILES.filter((profile) => getTopLevelUnionToolNames(profile).length === 0);
}
