import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import axios from 'axios';
import {
  buildToolCatalog,
  defineToolDiscoveryMetadata,
  getContextToolDefinitions,
  getContextToolSpecs,
  getToolNamesForProfile,
  measureToolDefinitionBudget,
} from '@agentteams/context-tools';
import { z } from 'zod';
import { startMcpServer } from '../src/mcp/server.js';
import { getWriteToolSpecs } from '../src/mcp/writeTools.js';
import { connect, discover, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;
const projectUrl = `${apiUrl}/api/projects/${projectId}`;
const KMA_PROJECT_ID = '78a24ae4-1816-4a04-8466-809686af9113';
const listEnvelope = {
  data: [{ id: 'item-1', title: 'metadata only' }],
  meta: { total: 21, page: 2, pageSize: 20, totalPages: 2 },
};

const LIST_CASES = [
  {
    tool: 'agentteams_plan_list',
    url: `${projectUrl}/plans`,
    arguments: {
      title: 'MCP',
      search: 'exact',
      status: 'IN_PROGRESS',
      type: 'FEATURE',
      priority: 'HIGH',
      assignedTo: 'agent-1',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
  },
  {
    tool: 'agentteams_report_list',
    url: `${projectUrl}/completion-reports`,
    arguments: {
      search: 'MCP',
      planId: 'agentteams_pln_plan-1',
      status: 'COMPLETED',
      reviewStatus: 'NOT_NEEDED',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
    expectedParams: {
      search: 'MCP',
      planId: 'plan-1',
      status: 'COMPLETED',
      reviewStatus: 'NOT_NEEDED',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
  },
  {
    tool: 'agentteams_coaction_list',
    url: `${projectUrl}/co-actions`,
    arguments: {
      search: 'handoff',
      status: 'OPEN',
      visibility: 'PRIVATE',
      source: 'MANUAL',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
  },
  {
    tool: 'agentteams_postmortem_list',
    url: `${projectUrl}/post-mortems`,
    arguments: {
      search: 'MCP',
      planId: 'agentteams_pln_plan-1',
      status: 'RESOLVED',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
    expectedParams: {
      search: 'MCP',
      planId: 'plan-1',
      status: 'RESOLVED',
      createdByMemberId: 'member-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 2,
      pageSize: 20,
    },
  },
  {
    tool: 'agentteams_document_list',
    url: `${projectUrl}/documents`,
    arguments: {
      q: 'MCP',
      createdByMemberId: 'member-1',
      tags: ['mcp', 'exact'],
      tagPrefix: 'engineering',
      untagged: false,
      favorite: false,
      visibility: 'PROJECT',
      archived: 'ALL',
      page: 0,
      pageSize: 100,
    },
    expectedParams: {
      q: 'MCP',
      createdByMemberId: 'member-1',
      tags: 'mcp,exact',
      tagPrefix: 'engineering',
      untagged: false,
      favorite: false,
      visibility: 'PROJECT',
      archived: 'ALL',
      page: 0,
      pageSize: 100,
    },
  },
  {
    tool: 'agentteams_convention_list',
    url: `${projectUrl}/conventions`,
    arguments: {
      category: 'rules',
      scope: 'PROJECT',
      archived: 'ACTIVE',
      search: 'MCP',
      createdByMemberId: 'member-1',
      page: 2,
      pageSize: 20,
    },
  },
  {
    tool: 'agentteams_codereview_list',
    url: `${projectUrl}/code-reviews`,
    arguments: {
      search: 'MCP',
      status: 'OPEN',
      targetType: 'GITHUB_PR',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      severity: 'P1',
      sourcePlanId: 'agentteams_pln_plan-1',
      sourceCompletionReportId: 'agentteams_rpt_report-1',
      createdByMemberId: 'member-1',
      page: 2,
      pageSize: 20,
    },
    expectedParams: {
      search: 'MCP',
      status: 'OPEN',
      targetType: 'GITHUB_PR',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      severity: 'P1',
      sourcePlanId: 'plan-1',
      sourceCompletionReportId: 'report-1',
      createdByMemberId: 'member-1',
      page: 2,
      pageSize: 20,
    },
  },
] as const;

const READ_ERROR_CASES = [
  ...[401, 403, 404, 500].map((status) => ({
    tool: 'agentteams_comment_get',
    arguments: { id: 'comment-1' },
    status,
  })),
  ...[401, 403, 404, 500].map((status) => ({
    tool: 'agentteams_codereview_finding_get',
    arguments: { id: 'finding-1' },
    status,
  })),
];

/**
 * The `minimal` profile is defined as "the always-on set and nothing else", so this
 * list must stay identical to the tools flagged `alwaysOn` in the catalog — the
 * classification test below asserts that equality rather than trusting this literal.
 * Desktop's Direct BYOK engine already exposes exactly these three tools upfront.
 */
const MINIMAL_PROFILE_TOOLS = ['agentteams_search', 'agentteams_plan_get', 'agentteams_document_get'] as const;

/**
 * Definition-budget baseline measured on 2026-08-05. `estimatedTokens` from
 * `measureToolDefinitionBudget` is the chars/4 heuristic, NOT a model tokenizer
 * count; `o200kTokens` below is the separately measured `o200k_base` figure and is
 * recorded here as a documented reference, not as a computed assertion.
 */
const BUDGET_BASELINE = {
  full: { totalChars: 45_240, heuristicTokens: 11_310, o200kTokens: 10_906 },
  minimal: { totalChars: 3_407, heuristicTokens: 852, o200kTokens: 782 },
} as const;

const PROFILE_CASES: Array<['read' | 'documents' | 'comments' | 'minimal', readonly string[]]> = [
  ['read', getContextToolSpecs().map(({ name }) => name)],
  [
    'documents',
    [
      'agentteams_search',
      'agentteams_document_list',
      'agentteams_document_get',
      'agentteams_guide_get',
      'agentteams_document_create',
      'agentteams_document_update',
      'agentteams_document_delete',
    ],
  ],
  [
    'comments',
    [
      'agentteams_search',
      'agentteams_comment_list',
      'agentteams_comment_get',
      'agentteams_comment_reply_list',
      'agentteams_comment_reply_get',
      'agentteams_guide_get',
      'agentteams_comment_create',
      'agentteams_comment_update',
      'agentteams_comment_delete',
      'agentteams_comment_reply_create',
      'agentteams_comment_reply_update',
      'agentteams_comment_reply_delete',
    ],
  ],
  ['minimal', MINIMAL_PROFILE_TOOLS],
];

describe('mcp exact list and missing detail tools', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('exposes exactly nine list, eleven get, and one search tool without duplicates', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const names = (response.result?.tools ?? []).map((tool: { name: string }) => tool.name);

    // 20 read tools + 10 write tools; agentteams_guide_get also ends in `_get`.
    expect(names).toHaveLength(30);
    expect(new Set(names).size).toBe(30);
    expect(names.filter((name: string) => name.endsWith('_list'))).toHaveLength(9);
    expect(names.filter((name: string) => name.endsWith('_get'))).toHaveLength(11);
    expect(names.filter((name: string) => name === 'agentteams_search')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'agentteams_codereview_get')).toHaveLength(1);
    expect(names).not.toContain('agentteams_code_review_get');
  });

  it('classifies the complete catalog into stable public profiles and reports its definition budget', () => {
    const readSpecs = getContextToolSpecs();
    const writeSpecs = getWriteToolSpecs();
    const catalog = buildToolCatalog([
      { kind: 'read', specs: readSpecs },
      { kind: 'write', specs: writeSpecs },
    ]);
    const definitions = [
      ...getContextToolDefinitions(),
      ...writeSpecs.map((spec) => ({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: z.toJSONSchema(spec.inputSchema),
      })),
    ];
    const budget = measureToolDefinitionBudget(definitions);

    expect(catalog).toHaveLength(30);
    expect(new Set(catalog.map(({ name }) => name)).size).toBe(30);
    expect(getToolNamesForProfile(catalog, 'full')).toEqual(catalog.map(({ name }) => name));
    expect(getToolNamesForProfile(catalog, 'read')).toEqual(readSpecs.map(({ name }) => name));
    expect(getToolNamesForProfile(catalog, 'documents')).toEqual([
      'agentteams_search',
      'agentteams_document_list',
      'agentteams_document_get',
      'agentteams_guide_get',
      'agentteams_document_create',
      'agentteams_document_update',
      'agentteams_document_delete',
    ]);
    expect(getToolNamesForProfile(catalog, 'comments')).toEqual([
      'agentteams_search',
      'agentteams_comment_list',
      'agentteams_comment_get',
      'agentteams_comment_reply_list',
      'agentteams_comment_reply_get',
      'agentteams_guide_get',
      'agentteams_comment_create',
      'agentteams_comment_update',
      'agentteams_comment_delete',
      'agentteams_comment_reply_create',
      'agentteams_comment_reply_update',
      'agentteams_comment_reply_delete',
    ]);
    expect(catalog.filter(({ discovery }) => discovery.alwaysOn).map(({ name }) => name)).toEqual([
      'agentteams_search',
      'agentteams_plan_get',
      'agentteams_document_get',
    ]);
    expect(budget).toMatchObject({ toolCount: 30 });
    expect(budget.descriptionChars).toBeGreaterThan(15_000);
    expect(budget.schemaChars).toBeGreaterThan(25_000);
    expect(budget.totalChars).toBeGreaterThan(43_000);
    expect(budget.totalChars).toBeLessThan(48_000);
    expect(budget.estimatedTokens).toBe(Math.ceil(budget.totalChars / 4));
    process.stderr.write(`[mcp catalog budget] ${JSON.stringify(budget)}\n`);
  });

  it('scopes the minimal profile to the always-on set and keeps its definition budget under 4,000 chars', () => {
    const readSpecs = getContextToolSpecs();
    const writeSpecs = getWriteToolSpecs();
    const catalog = buildToolCatalog([
      { kind: 'read', specs: readSpecs },
      { kind: 'write', specs: writeSpecs },
    ]);
    const minimalNames = getToolNamesForProfile(catalog, 'minimal');

    // `minimal` is *defined* as the always-on set: assert the equality rather than
    // a hand-written literal, so a newly always-on tool cannot silently diverge.
    expect(minimalNames).toEqual(catalog.filter(({ discovery }) => discovery.alwaysOn).map(({ name }) => name));
    expect(minimalNames).toEqual([...MINIMAL_PROFILE_TOOLS]);

    // Adding `minimal` must not pull any tool into or out of the four existing profiles.
    expect(getToolNamesForProfile(catalog, 'full')).toEqual(catalog.map(({ name }) => name));
    expect(getToolNamesForProfile(catalog, 'read')).toEqual(readSpecs.map(({ name }) => name));

    const minimalDefinitions = getContextToolDefinitions().filter((definition) =>
      minimalNames.includes(definition.name),
    );
    const minimalBudget = measureToolDefinitionBudget(minimalDefinitions);
    const fullBudget = measureToolDefinitionBudget([
      ...getContextToolDefinitions(),
      ...writeSpecs.map((spec) => ({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: z.toJSONSchema(spec.inputSchema),
      })),
    ]);

    expect(minimalBudget.toolCount).toBe(3);
    expect(minimalBudget.totalChars).toBeLessThan(4_000);
    expect(minimalBudget.totalChars).toBeLessThan(fullBudget.totalChars / 10);
    // `estimatedTokens` is the chars/4 heuristic; the o200k_base column of
    // BUDGET_BASELINE is the separately measured tokenizer figure. Keep them apart.
    expect(minimalBudget.estimatedTokens).toBe(Math.ceil(minimalBudget.totalChars / 4));
    process.stderr.write(
      `[mcp minimal budget] ${JSON.stringify({
        measured: { full: fullBudget, minimal: minimalBudget },
        baseline_2026_08_05: BUDGET_BASELINE,
      })}\n`,
    );
  });

  /**
   * The equality above is asserted on the *current* catalog; this asserts the rule that
   * produces it. `defineToolDiscoveryMetadata` refuses any tool whose `alwaysOn` flag and
   * `minimal` membership disagree, so the contract holds at import time in every consumer
   * — including a PR that only touches `packages/context-tools` and never runs this suite.
   */
  it('rejects a tool whose always-on flag and minimal membership disagree', () => {
    expect(() => defineToolDiscoveryMetadata({ domain: 'search', profiles: ['full', 'minimal'] })).toThrow(
      'The "minimal" profile must contain exactly the always-on tools',
    );
    expect(() =>
      defineToolDiscoveryMetadata({ domain: 'search', profiles: ['full'], deferable: false, alwaysOn: true }),
    ).toThrow('The "minimal" profile must contain exactly the always-on tools');

    // The two consistent shapes still pass.
    expect(() =>
      defineToolDiscoveryMetadata({
        domain: 'search',
        profiles: ['full', 'minimal'],
        deferable: false,
        alwaysOn: true,
      }),
    ).not.toThrow();
    expect(() => defineToolDiscoveryMetadata({ domain: 'search', profiles: ['full'] })).not.toThrow();
  });

  it('keeps provider-facing context definitions free of internal discovery metadata', () => {
    for (const definition of getContextToolDefinitions()) {
      expect(Object.keys(definition).sort()).toEqual(['description', 'inputSchema', 'name', 'title']);
    }
  });

  it.each(PROFILE_CASES)(
    'registers exactly the %s profile and rejects calls outside it',
    async (profile, expectedNames) => {
      const { client, handle } = connect(TEST_TOOL_CONTEXT, profile);
      openHandle = handle;

      await discover(client);
      const response = await client.request('tools/list', { _meta: MODERN_META });
      expect((response.result?.tools ?? []).map((tool: { name: string }) => tool.name)).toEqual(expectedNames);

      const excludedTool = profile === 'documents' ? 'agentteams_comment_get' : 'agentteams_document_create';
      const call = await client.request('tools/call', {
        name: excludedTool,
        arguments: {},
        _meta: MODERN_META,
      });
      expect(call.error?.message).toBe(`Tool ${excludedTool} not found`);
    },
  );

  it('rejects an invalid profile before resolving credentials or starting stdio', async () => {
    await expect(startMcpServer({ toolProfile: 'everything' })).rejects.toThrow(
      'Unsupported tool profile: everything. Use full, read, documents, comments, minimal.',
    );
  });

  it.each(LIST_CASES)('$tool passes all filters to its existing HTTP endpoint', async (testCase) => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: testCase.tool,
      arguments: testCase.arguments,
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    expect(getSpy).toHaveBeenCalledWith(testCase.url, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: 'expectedParams' in testCase ? testCase.expectedParams : testCase.arguments,
    });
    expect(JSON.parse(call.result?.content[0].text)).toEqual(listEnvelope);
  });

  it('binds coaction_list to the KMA project URL from its MCP context', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const context = { ...TEST_TOOL_CONTEXT, projectId: KMA_PROJECT_ID };
    const { client, handle } = connect(context);
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_coaction_list',
      arguments: { status: 'OPEN', source: 'MANUAL' },
      _meta: MODERN_META,
    });

    expect(call.result?.isError).toBeFalsy();
    expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${KMA_PROJECT_ID}/co-actions`, {
      headers: context.headers,
      params: { status: 'OPEN', source: 'MANUAL' },
    });
  });

  it.each([
    ['defaults an omitted source to MANUAL', {}, { source: 'MANUAL' }],
    ['preserves an explicit AUTO_SESSION source', { source: 'AUTO_SESSION' }, { source: 'AUTO_SESSION' }],
    ['drops the source filter for ALL', { source: 'ALL' }, {}],
    ['keeps other filters alongside the default source', { status: 'OPEN' }, { status: 'OPEN', source: 'MANUAL' }],
    ['keeps other filters when ALL removes the source', { status: 'OPEN', source: 'ALL' }, { status: 'OPEN' }],
  ])('coaction_list %s', async (_label, toolArguments, expectedParams) => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_coaction_list',
      arguments: toolArguments,
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    // An empty filter set omits `params` entirely (existing api/coaction.ts behavior).
    expect(getSpy).toHaveBeenCalledWith(`${projectUrl}/co-actions`, {
      headers: TEST_TOOL_CONTEXT.headers,
      ...(Object.keys(expectedParams).length > 0 ? { params: expectedParams } : {}),
    });
  });

  it('documents the coaction_list source default in the tool description body', () => {
    const definition = getContextToolDefinitions().find(({ name }) => name === 'agentteams_coaction_list');

    expect(definition?.description).toContain('MANUAL');
    expect(definition?.description).toContain('AUTO_SESSION');
    expect(definition?.description).toContain('ALL');
  });

  it('routes plan, finding, task, and document comments to their parent-scoped endpoints', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const calls = [
      {
        arguments: {
          planId: 'agentteams_pln_plan-1',
          type: 'RISK',
          order: 'desc',
          page: 2,
          pageSize: 20,
        },
        url: `${projectUrl}/plans/plan-1/comments`,
        params: { type: 'RISK', order: 'desc', page: 2, pageSize: 20 },
      },
      {
        arguments: {
          findingId: 'agentteams_rvf_finding-1',
          order: 'asc',
          page: 2,
          pageSize: 20,
        },
        url: `${projectUrl}/code-reviews/findings/finding-1/comments`,
        params: { order: 'asc', page: 2, pageSize: 20 },
      },
      {
        arguments: {
          taskId: 'agentteams_tsk_task-1',
          planId: 'agentteams_pln_plan-1',
          order: 'desc',
          page: 2,
          pageSize: 20,
        },
        url: `${projectUrl}/plans/tasks/task-1/comments`,
        params: { planId: 'plan-1', order: 'desc', page: 2, pageSize: 20 },
      },
      {
        arguments: {
          documentId: 'agentteams_doc_document-1',
          order: 'asc',
          page: 1,
          pageSize: 20,
        },
        url: `${projectUrl}/documents/document-1/comments`,
        params: { order: 'asc', page: 1, pageSize: 20 },
      },
    ];

    for (const testCase of calls) {
      const response = await client.request('tools/call', {
        name: 'agentteams_comment_list',
        arguments: testCase.arguments,
        _meta: MODERN_META,
      });
      expect(response.result?.isError).toBeFalsy();
      expect(JSON.parse(response.result?.content[0].text)).toEqual(listEnvelope);
    }

    expect(getSpy).toHaveBeenNthCalledWith(1, calls[0].url, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: calls[0].params,
    });
    expect(getSpy).toHaveBeenNthCalledWith(2, calls[1].url, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: calls[1].params,
    });
    expect(getSpy).toHaveBeenNthCalledWith(3, calls[2].url, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: calls[2].params,
    });
    expect(getSpy).toHaveBeenNthCalledWith(4, calls[3].url, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: calls[3].params,
    });
  });

  it('rejects ambiguous comment targets as a tool error and keeps serving', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const rejected = await client.request('tools/call', {
      name: 'agentteams_comment_list',
      arguments: { planId: 'plan-1', findingId: 'finding-1' },
      _meta: MODERN_META,
    });
    const accepted = await client.request('tools/call', {
      name: 'agentteams_comment_list',
      arguments: { taskId: 'task-1', planId: 'plan-1' },
      _meta: MODERN_META,
    });

    expect(rejected.result?.isError).toBe(true);
    expect(accepted.result?.isError).toBeFalsy();
  });

  it('passes raw comment ids through and normalizes finding and parent review ids', async () => {
    const commentEnvelope = { data: { id: 'agentteams_pln_raw-comment', content: 'full comment' } };
    const findingEnvelope = {
      data: { finding: { id: 'finding-1' }, review: { id: 'review-1', title: 'parent review' } },
    };
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: commentEnvelope } as never)
      .mockResolvedValueOnce({ data: findingEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const comment = await client.request('tools/call', {
      name: 'agentteams_comment_get',
      arguments: { id: 'agentteams_pln_raw-comment' },
      _meta: MODERN_META,
    });
    const finding = await client.request('tools/call', {
      name: 'agentteams_codereview_finding_get',
      arguments: {
        id: 'agentteams_rvf_finding-1',
        codeReviewId: 'agentteams_rev_review-1',
      },
      _meta: MODERN_META,
    });

    expect(getSpy).toHaveBeenNthCalledWith(1, `${projectUrl}/comments/agentteams_pln_raw-comment`, {
      headers: TEST_TOOL_CONTEXT.headers,
    });
    expect(getSpy).toHaveBeenNthCalledWith(2, `${projectUrl}/code-reviews/findings/finding-1`, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: { codeReviewId: 'review-1' },
    });
    expect(JSON.parse(comment.result?.content[0].text)).toEqual(commentEnvelope);
    expect(JSON.parse(finding.result?.content[0].text)).toEqual(findingEnvelope);
  });

  it.each(READ_ERROR_CASES)('$tool maps upstream $status to a tool error and keeps serving', async (testCase) => {
    const failure = Object.assign(new Error(`Request failed with status code ${testCase.status}`), {
      isAxiosError: true,
      response: { status: testCase.status, data: { message: 'upstream failure' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(failure as never);
    getSpy.mockResolvedValue({ data: { data: { id: 'recovered' } } } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const failed = await client.request('tools/call', {
      name: testCase.tool,
      arguments: testCase.arguments,
      _meta: MODERN_META,
    });
    const recovered = await client.request('tools/call', {
      name: testCase.tool,
      arguments: testCase.arguments,
      _meta: MODERN_META,
    });

    expect(failed.result?.isError).toBe(true);
    expect(recovered.result?.isError).toBeFalsy();
  });
});
