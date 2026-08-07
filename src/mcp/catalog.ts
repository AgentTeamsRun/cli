import {
  buildToolCatalog,
  getToolNamesForProfile,
  type ContextToolSpec,
  type ToolProfile,
} from '@agentteams/context-tools';
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
