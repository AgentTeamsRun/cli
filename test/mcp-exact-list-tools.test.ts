import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import axios from 'axios';
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

describe('mcp exact list and missing detail tools', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('exposes exactly eight list, ten get, and one search tool without duplicates', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const names = (response.result?.tools ?? []).map((tool: { name: string }) => tool.name);

    // 18 read tools + 4 write tools; agentteams_guide_get also ends in `_get`.
    expect(names).toHaveLength(22);
    expect(new Set(names).size).toBe(22);
    expect(names.filter((name: string) => name.endsWith('_list'))).toHaveLength(8);
    expect(names.filter((name: string) => name.endsWith('_get'))).toHaveLength(10);
    expect(names.filter((name: string) => name === 'agentteams_search')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'agentteams_codereview_get')).toHaveLength(1);
    expect(names).not.toContain('agentteams_code_review_get');
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
