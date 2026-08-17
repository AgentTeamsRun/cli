import { describe, expect, it } from '@jest/globals';
import { getContextToolSpecs, measureToolDefinitionBudget, TOOL_PROFILES } from '@agentteams/context-tools';
import { z } from 'zod';
import { getProfileToolSpecs, getUnionFreeToolProfiles } from '../src/mcp/catalog.js';

const definitionOf = (spec: { name: string; title?: string; description: string; inputSchema: z.ZodType }) => ({
  name: spec.name,
  title: spec.title,
  description: spec.description,
  inputSchema: z.toJSONSchema(spec.inputSchema),
});

const measureProfile = (profile: (typeof TOOL_PROFILES)[number]) => {
  const { readTools, localTools, writeTools } = getProfileToolSpecs(profile);
  const specs = [...readTools, ...localTools, ...writeTools];
  return {
    profile,
    ...measureToolDefinitionBudget(specs.map(definitionOf)),
  };
};

describe('mcp catalog size after stage 4 write tools', () => {
  it('keeps full in the union-free profile set so Kiro is not locked again', () => {
    const unionFree = getUnionFreeToolProfiles();
    expect(unionFree).toContain('full');
    expect(unionFree).toEqual([...TOOL_PROFILES]);
  });

  it('records per-profile tool counts and serialized catalog size', () => {
    const measurements = TOOL_PROFILES.map(measureProfile);
    process.stderr.write(`[mcp stage-4 catalog] ${JSON.stringify(measurements)}\n`);

    const byProfile = Object.fromEntries(measurements.map((item) => [item.profile, item]));

    // Stage 3 was 14 write tools (39 total in full). Stage 4 adds 3 write tools (42 total in full).
    expect(byProfile.full?.toolCount).toBe(42);
    expect(byProfile.read?.toolCount).toBe(getContextToolSpecs().length);
    expect(byProfile.documents?.toolCount).toBe(7);
    expect(byProfile.comments?.toolCount).toBe(12);
    expect(byProfile.minimal?.toolCount).toBe(3);

    expect(byProfile.full?.totalChars).toBeGreaterThan(60_000);
    expect(byProfile.full?.totalChars).toBeLessThan(70_000);
    expect(byProfile.minimal?.totalChars).toBeLessThan(4_000);
  });
});
