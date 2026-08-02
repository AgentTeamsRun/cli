import { TOOL_PROFILES, type ToolProfile } from '@agentteams/context-tools';

export function parseToolProfile(value: unknown): ToolProfile {
  if (value === undefined || value === null || value === '') return 'full';
  if (typeof value === 'string' && TOOL_PROFILES.some((profile) => profile === value)) return value as ToolProfile;
  throw new Error(`Unsupported tool profile: ${String(value)}. Use ${TOOL_PROFILES.join(', ')}.`);
}
