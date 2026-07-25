import { describe, expect, it } from '@jest/globals';
import { CONTEXT_TOOL_SEARCH_TYPES, getContextToolSpecs, stripContextEntityIdPrefix } from '@agentteams/context-tools';
import { z } from 'zod';
import { stripEntityIdPrefix } from '../src/utils/entityId.js';
import { VALID_TYPES } from '../src/utils/searchParams.js';

const expectedContract = [
  { name: 'agentteams_search', required: ['query'], properties: ['limit', 'maxTokens', 'query', 'types'] },
  { name: 'agentteams_plan_get', required: ['id'], properties: ['id'] },
  { name: 'agentteams_report_get', required: ['id'], properties: ['id'] },
  { name: 'agentteams_coaction_get', required: ['id'], properties: ['id'] },
  { name: 'agentteams_postmortem_get', required: ['id'], properties: ['id'] },
  { name: 'agentteams_document_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_convention_list',
    required: [],
    properties: ['archived', 'category', 'createdByMemberId', 'page', 'pageSize', 'scope', 'search'],
  },
  { name: 'agentteams_convention_get', required: ['id'], properties: ['id'] },
];

describe('shared context-tools contract', () => {
  it('keeps the eight pre-extraction tool names and input shapes unchanged', () => {
    const actual = getContextToolSpecs().map((spec) => {
      const schema = z.toJSONSchema(spec.inputSchema) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      return {
        name: spec.name,
        required: [...(schema.required ?? [])].sort(),
        properties: Object.keys(schema.properties ?? {}).sort(),
      };
    });

    expect(actual).toEqual(expectedContract);
  });

  it('keeps the search type catalog unchanged', () => {
    const search = getContextToolSpecs()[0];
    const schema = z.toJSONSchema(search.inputSchema) as {
      properties?: { types?: { items?: { enum?: string[] } } };
    };

    expect(VALID_TYPES).toBe(CONTEXT_TOOL_SEARCH_TYPES);
    expect(schema.properties?.types?.items?.enum).toEqual(CONTEXT_TOOL_SEARCH_TYPES);
  });

  it('uses the shared entity id prefix normalizer', () => {
    const fixtures: unknown[] = [
      'agentteams_pln_fixture-id',
      'agentteams_rpt_fixture-id',
      'agentteams_rvf_fixture-id',
      'bare-id',
      undefined,
      42,
    ];

    for (const fixture of fixtures) {
      expect(stripEntityIdPrefix(fixture)).toBe(stripContextEntityIdPrefix(fixture));
    }
  });
});
