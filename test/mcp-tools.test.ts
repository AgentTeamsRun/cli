import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { connect, discover, initializeLegacy, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;

// Shaped after the plan runbook endpoint: `{ data: { plan, tasks, progress } }`
// with contentMarkdown, V2 task dependencies and progress counters.
const planRunbookResponse = {
  data: {
    plan: {
      id: 'plan-1',
      title: 'MCP Phase 1',
      status: 'IN_PROGRESS',
      contentMarkdown: '## TL;DR\n\nRead tools + resources.',
    },
    tasks: [
      { id: 'task-1', number: 1, status: 'DONE', dependsOnTaskIds: [] },
      { id: 'task-2', number: 2, status: 'TODO', dependsOnTaskIds: ['task-1'] },
    ],
    progress: { total: 2, completed: 1, percent: 50 },
  },
};

const documentResponse = {
  data: {
    id: 'doc-1',
    title: 'Design note',
    body: '# Full document body\n\nEverything included.',
    bodyTiptap: { type: 'doc', content: [] },
    isFavorite: false,
  },
};

const ENTITY_GET_CASES = [
  {
    tool: 'agentteams_plan_get',
    prefixedId: 'agentteams_pln_11111111-1111-7111-8111-111111111111',
    bareId: '11111111-1111-7111-8111-111111111111',
    url: `${apiUrl}/api/projects/${projectId}/plans/11111111-1111-7111-8111-111111111111/runbook`,
    response: planRunbookResponse,
  },
  {
    tool: 'agentteams_report_get',
    prefixedId: 'agentteams_rpt_22222222-2222-7222-8222-222222222222',
    bareId: '22222222-2222-7222-8222-222222222222',
    url: `${apiUrl}/api/projects/${projectId}/completion-reports/22222222-2222-7222-8222-222222222222`,
    response: { data: { id: 'report-1', content: 'full report' } },
  },
  {
    tool: 'agentteams_coaction_get',
    prefixedId: 'agentteams_act_33333333-3333-7333-8333-333333333333',
    bareId: '33333333-3333-7333-8333-333333333333',
    url: `${apiUrl}/api/projects/${projectId}/co-actions/33333333-3333-7333-8333-333333333333`,
    response: { data: { id: 'coaction-1', content: 'full co-action' } },
  },
  {
    tool: 'agentteams_postmortem_get',
    prefixedId: 'agentteams_pmt_44444444-4444-7444-8444-444444444444',
    bareId: '44444444-4444-7444-8444-444444444444',
    url: `${apiUrl}/api/projects/${projectId}/post-mortems/44444444-4444-7444-8444-444444444444`,
    response: { data: { id: 'postmortem-1', content: 'full post-mortem' } },
  },
  {
    tool: 'agentteams_document_get',
    prefixedId: 'agentteams_doc_55555555-5555-7555-8555-555555555555',
    bareId: '55555555-5555-7555-8555-555555555555',
    url: `${apiUrl}/api/projects/${projectId}/documents/55555555-5555-7555-8555-555555555555`,
    response: documentResponse,
  },
] as const;

describe('mcp entity read tools', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('lists every detail tool with an id-only input contract', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const list = await client.request('tools/list', { _meta: MODERN_META });
    const tools = list.result?.tools ?? [];
    const names = tools.map((tool: { name: string }) => tool.name);

    for (const testCase of ENTITY_GET_CASES) {
      expect(names).toContain(testCase.tool);
      const tool = tools.find((entry: any) => entry.name === testCase.tool);
      expect(tool.inputSchema.required).toEqual(['id']);
      // Detail tools must teach the cost model: search first, then fetch.
      expect(tool.description).toContain('contentTokenCount');
      expect(tool.description).toContain('verbatim');
    }
  });

  it.each(ENTITY_GET_CASES)(
    '$tool normalizes prefixed ids and passes the upstream envelope through verbatim',
    async (testCase) => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: testCase.response } as never);
      const { client, handle } = connect();
      openHandle = handle;

      await discover(client);
      const prefixed = await client.request('tools/call', {
        name: testCase.tool,
        arguments: { id: testCase.prefixedId },
        _meta: MODERN_META,
      });

      expect(prefixed.error).toBeUndefined();
      expect(prefixed.result?.isError).toBeFalsy();
      expect(getSpy).toHaveBeenLastCalledWith(testCase.url, { headers: TEST_TOOL_CONTEXT.headers });
      expect(JSON.parse(prefixed.result?.content[0].text)).toEqual(testCase.response);

      const bare = await client.request('tools/call', {
        name: testCase.tool,
        arguments: { id: testCase.bareId },
        _meta: MODERN_META,
      });

      // Bare and prefixed ids must resolve to the same request URL.
      expect(getSpy).toHaveBeenLastCalledWith(testCase.url, { headers: TEST_TOOL_CONTEXT.headers });
      expect(JSON.parse(bare.result?.content[0].text)).toEqual(testCase.response);
    },
  );

  it('preserves V2 task dependencies and progress in plan_get responses', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: planRunbookResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'plan-1' },
      _meta: MODERN_META,
    });

    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data.tasks[1].dependsOnTaskIds).toEqual(['task-1']);
    expect(payload.data.progress).toEqual({ total: 2, completed: 1, percent: 50 });
    expect(payload.data.plan.contentMarkdown).toContain('Read tools');
  });

  it('preserves the document body in document_get responses', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: documentResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_document_get',
      arguments: { id: 'doc-1' },
      _meta: MODERN_META,
    });

    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data.body).toBe('# Full document body\n\nEverything included.');
  });

  it.each([[401], [403], [404], [500]])('maps an upstream %s to a tool error and keeps serving', async (status) => {
    const failure = Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status, data: { message: 'upstream failure' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(failure as never);
    getSpy.mockResolvedValue({ data: planRunbookResponse } as never);

    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const failed = await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'plan-1' },
      _meta: MODERN_META,
    });

    expect(failed.result?.isError).toBe(true);

    const recovered = await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'plan-1' },
      _meta: MODERN_META,
    });

    expect(recovered.result?.isError).toBeFalsy();
    expect(JSON.parse(recovered.result?.content[0].text)).toEqual(planRunbookResponse);
  });

  it('serves detail tools on the legacy path too', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: planRunbookResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await initializeLegacy(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'agentteams_pln_plan-1' },
    });

    expect(call.error).toBeUndefined();
    expect(JSON.parse(call.result?.content[0].text)).toEqual(planRunbookResponse);
  });
});
