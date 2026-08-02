import {
  buildToolCatalog,
  getToolNamesForProfile,
  type ContextToolSpec,
  type ToolProfile,
} from '@agentteams/context-tools';
import { getToolSpecs } from './tools.js';
import { getWriteToolSpecs, type McpWriteToolSpec } from './writeTools.js';

export interface ProfileToolSpecs {
  readTools: ContextToolSpec[];
  writeTools: McpWriteToolSpec[];
}

/** Build and validate the complete catalog before selecting one public profile. */
export function getProfileToolSpecs(profile: ToolProfile): ProfileToolSpecs {
  const readTools = getToolSpecs();
  const writeTools = getWriteToolSpecs();
  const catalog = buildToolCatalog([
    { kind: 'read', specs: readTools },
    { kind: 'write', specs: writeTools },
  ]);
  const includedNames = new Set(getToolNamesForProfile(catalog, profile));

  return {
    readTools: readTools.filter(({ name }) => includedNames.has(name)),
    writeTools: writeTools.filter(({ name }) => includedNames.has(name)),
  };
}
