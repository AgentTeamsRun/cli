import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { connect, discover, initializeLegacy, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;
const conventionsUrl = `${apiUrl}/api/projects/${projectId}/conventions`;

const listEnvelope = {
  data: [
    {
      id: 'conv-1',
      title: 'testing rules',
      category: 'rules',
      scope: 'PERSONAL',
      updatedAt: '2026-07-25T00:00:00.000Z',
    },
  ],
  meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
};

const detailEnvelope = {
  data: {
    id: 'conv-1',
    title: 'testing rules',
    category: 'rules',
    scope: 'PERSONAL',
    contentMarkdown: '# Testing rules\n\nAlways add characterization tests first.',
  },
};

describe('mcp convention tools', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('exposes the complete read tool catalog including the two convention tools', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const list = await client.request('tools/list', { _meta: MODERN_META });
    const names = (list.result?.tools ?? []).map((tool: { name: string }) => tool.name);

    // 23 shared read tools + 2 CLI-local tools (guide handoff, reference resolve)
    // + 9 write tools (document/comment create/update/delete).
    expect(names).toHaveLength(34);
    expect(names).toEqual(
      expect.arrayContaining([
        'agentteams_search',
        'agentteams_plan_get',
        'agentteams_report_get',
        'agentteams_coaction_get',
        'agentteams_postmortem_get',
        'agentteams_document_get',
        'agentteams_convention_list',
        'agentteams_convention_get',
        'agentteams_codereview_get',
      ]),
    );
  });

  it('tells agents to search conventions first and use the list tool for exact filtering', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const list = await client.request('tools/list', { _meta: MODERN_META });
    const tools = list.result?.tools ?? [];

    for (const name of ['agentteams_convention_list', 'agentteams_convention_get']) {
      const tool = tools.find((entry: any) => entry.name === name);
      expect(tool).toBeDefined();
      expect(tool.description).toContain('agentteams_search');
      expect(tool.description).toContain('exact');
      expect(tool.description).not.toContain('not part of semantic search');
    }
  });

  it('passes every list filter through to the HTTP params losslessly', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: {
        category: 'rules',
        scope: 'PERSONAL',
        archived: 'ACTIVE',
        search: 'testing',
        createdByMemberId: 'member-1',
        page: 1,
        pageSize: 20,
      },
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    expect(getSpy).toHaveBeenCalledWith(conventionsUrl, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: {
        category: 'rules',
        scope: 'PERSONAL',
        archived: 'ACTIVE',
        search: 'testing',
        createdByMemberId: 'member-1',
        page: 1,
        pageSize: 20,
      },
    });
    // data + meta must survive verbatim so agents can paginate correctly.
    expect(JSON.parse(call.result?.content[0].text)).toEqual(listEnvelope);
  });

  it('omits the params object entirely when no filters are given', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: {},
      _meta: MODERN_META,
    });

    expect(getSpy).toHaveBeenCalledWith(conventionsUrl, { headers: TEST_TOOL_CONTEXT.headers });
  });

  it('rejects an invalid scope value as a tool error and keeps serving', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const rejected = await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: { scope: 'TEAM' },
      _meta: MODERN_META,
    });

    expect(rejected.result?.isError).toBe(true);

    const accepted = await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: { scope: 'PROJECT' },
      _meta: MODERN_META,
    });

    expect(accepted.result?.isError).toBeFalsy();
  });

  it('convention_get resolves prefixed ids and preserves contentMarkdown', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: detailEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_convention_get',
      arguments: { id: 'agentteams_cnv_conv-1' },
      _meta: MODERN_META,
    });

    expect(getSpy).toHaveBeenCalledWith(`${conventionsUrl}/conv-1`, { headers: TEST_TOOL_CONTEXT.headers });
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload).toEqual(detailEnvelope);
    expect(payload.data.contentMarkdown).toContain('characterization tests');
  });

  it('keeps an inaccessible personal convention as a tool error and continues serving', async () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404, data: { message: 'Convention not found' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(notFound as never);
    getSpy.mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const denied = await client.request('tools/call', {
      name: 'agentteams_convention_get',
      arguments: { id: 'other-member-personal' },
      _meta: MODERN_META,
    });

    expect(denied.result?.isError).toBe(true);
    expect(denied.result?.content[0].text).toContain('Convention not found');
    expect(denied.result?.content[0].text).not.toContain('contentMarkdown');

    const recovered = await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: { scope: 'PERSONAL' },
      _meta: MODERN_META,
    });
    expect(recovered.result?.isError).toBeFalsy();
  });

  it('connects a CONVENTION search result to convention_get', async () => {
    const searchEnvelope = {
      data: [{ id: 'agentteams_cnv_conv-1', entityType: 'CONVENTION', title: 'testing rules' }],
      meta: { truncatedByTokenBudget: false },
    };
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: searchEnvelope } as never)
      .mockResolvedValueOnce({ data: detailEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const searchCall = await client.request('tools/call', {
      name: 'agentteams_search',
      arguments: { query: 'testing rules', types: ['CONVENTION'] },
      _meta: MODERN_META,
    });
    const searchResult = JSON.parse(searchCall.result?.content[0].text);
    const getCall = await client.request('tools/call', {
      name: 'agentteams_convention_get',
      arguments: { id: searchResult.data[0].id },
      _meta: MODERN_META,
    });

    expect(getSpy.mock.calls[0]?.[0]).toContain('types=CONVENTION');
    expect(getSpy).toHaveBeenNthCalledWith(2, `${conventionsUrl}/conv-1`, {
      headers: TEST_TOOL_CONTEXT.headers,
    });
    expect(JSON.parse(getCall.result?.content[0].text)).toEqual(detailEnvelope);
  });

  it('serves the list → get flow on the legacy path too', async () => {
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: listEnvelope } as never)
      .mockResolvedValueOnce({ data: detailEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await initializeLegacy(client);

    const listCall = await client.request('tools/call', {
      name: 'agentteams_convention_list',
      arguments: { scope: 'PERSONAL', page: 1, pageSize: 20 },
    });
    const listedId = JSON.parse(listCall.result?.content[0].text).data[0].id;

    const getCall = await client.request('tools/call', {
      name: 'agentteams_convention_get',
      arguments: { id: listedId },
    });

    expect(getSpy).toHaveBeenNthCalledWith(1, conventionsUrl, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: { scope: 'PERSONAL', page: 1, pageSize: 20 },
    });
    expect(getSpy).toHaveBeenNthCalledWith(2, `${conventionsUrl}/conv-1`, { headers: TEST_TOOL_CONTEXT.headers });
    expect(JSON.parse(getCall.result?.content[0].text)).toEqual(detailEnvelope);
  });
});
