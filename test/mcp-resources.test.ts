import { describe, it, expect, afterEach, jest } from '@jest/globals';
import type { ToolProfile } from '@agentteams/context-tools';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { connect, discover, initializeLegacy, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;

const EXPECTED_TEMPLATES = ['agentteams://plan/{id}', 'agentteams://document/{id}', 'agentteams://convention/{id}'];
const EXPECTED_PROFILE_TEMPLATES: Record<ToolProfile, string[]> = {
  full: EXPECTED_TEMPLATES,
  read: EXPECTED_TEMPLATES,
  documents: ['agentteams://document/{id}'],
  comments: [],
  // `minimal` carries plan_get and document_get, so their templates come along and the
  // convention template — whose tool is not in the profile — drops out.
  minimal: ['agentteams://plan/{id}', 'agentteams://document/{id}'],
};

const planRunbookResponse = {
  data: {
    plan: { id: 'plan-1', title: 'MCP Phase 1', contentMarkdown: '## Runbook body' },
    tasks: [{ id: 'task-1', number: 1, status: 'TODO', dependsOnTaskIds: [] }],
    progress: { total: 1, completed: 0, percent: 0 },
  },
};

const documentResponse = {
  data: {
    id: 'doc-1',
    title: 'Design note',
    body: '# Full body',
    bodyTiptap: '{"type":"doc","content":[]}',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
};

const conventionResponse = {
  data: { id: 'conv-1', title: 'testing rules', contentMarkdown: '# Testing rules' },
};

describe('mcp read resources', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('lists exactly the three URI templates on the modern path', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const list = await client.request('resources/templates/list', { _meta: MODERN_META });

    expect(list.error).toBeUndefined();
    const templates = (list.result?.resourceTemplates ?? []).map((entry: any) => entry.uriTemplate);
    expect(templates).toHaveLength(3);
    expect(templates).toEqual(expect.arrayContaining(EXPECTED_TEMPLATES));
  });

  it.each(Object.entries(EXPECTED_PROFILE_TEMPLATES) as [ToolProfile, string[]][])(
    'limits %s resource templates to matching profile tools',
    async (profile, expectedTemplates) => {
      const { client, handle } = connect(TEST_TOOL_CONTEXT, profile);
      openHandle = handle;

      await discover(client);
      const list = await client.request('resources/templates/list', { _meta: MODERN_META });
      const templates = (list.result?.resourceTemplates ?? []).map((entry: any) => entry.uriTemplate);

      expect(templates).toEqual(expectedTemplates);
    },
  );

  it('rejects a resource read whose matching tool is outside the selected profile', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: planRunbookResponse } as never);
    const { client, handle } = connect(TEST_TOOL_CONTEXT, 'comments');
    openHandle = handle;

    await discover(client);
    const read = await client.request('resources/read', {
      uri: 'agentteams://plan/plan-1',
      _meta: MODERN_META,
    });

    expect(read.result).toBeUndefined();
    expect(read.error).toBeDefined();
  });

  it('lists the same three templates on the legacy path and keeps resources/list empty', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await initializeLegacy(client);
    const templateList = await client.request('resources/templates/list', {});

    expect(templateList.error).toBeUndefined();
    const templates = (templateList.result?.resourceTemplates ?? []).map((entry: any) => entry.uriTemplate);
    expect(templates).toHaveLength(3);
    expect(templates).toEqual(expect.arrayContaining(EXPECTED_TEMPLATES));

    // Dynamic templates advertise no enumerable instances: full entity
    // enumeration stays a search/list-tool concern.
    const staticList = await client.request('resources/list', {});
    expect(staticList.error).toBeUndefined();
    expect(staticList.result?.resources ?? []).toEqual([]);
  });

  it.each([
    ['agentteams://plan/plan-1', `${apiUrl}/api/projects/${projectId}/plans/plan-1/runbook`, planRunbookResponse],
    ['agentteams://convention/conv-1', `${apiUrl}/api/projects/${projectId}/conventions/conv-1`, conventionResponse],
  ])('reads %s as application/json with the upstream envelope verbatim', async (uri, expectedUrl, response) => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: response } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const read = await client.request('resources/read', { uri, _meta: MODERN_META });

    expect(read.error).toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith(expectedUrl, { headers: TEST_TOOL_CONTEXT.headers });
    const contents = read.result?.contents ?? [];
    expect(contents).toHaveLength(1);
    expect(contents[0].uri).toBe(uri);
    expect(contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(contents[0].text)).toEqual(response);
  });

  it('drops bodyTiptap from a document resource while keeping body and updatedAt', async () => {
    const expectedUrl = `${apiUrl}/api/projects/${projectId}/documents/doc-1`;
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: documentResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const read = await client.request('resources/read', {
      uri: 'agentteams://document/doc-1',
      _meta: MODERN_META,
    });

    expect(read.error).toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith(expectedUrl, { headers: TEST_TOOL_CONTEXT.headers });
    const payload = JSON.parse(read.result?.contents[0].text);
    expect(payload.data).not.toHaveProperty('bodyTiptap');
    expect(payload.data).toMatchObject({
      id: 'doc-1',
      body: '# Full body',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('returns the same payload for a resource read and the matching tool call', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: documentResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const toolCall = await client.request('tools/call', {
      name: 'agentteams_document_get',
      arguments: { id: 'doc-1' },
      _meta: MODERN_META,
    });
    const read = await client.request('resources/read', {
      uri: 'agentteams://document/doc-1',
      _meta: MODERN_META,
    });

    const resourcePayload = JSON.parse(read.result?.contents[0].text);
    const toolPayload = JSON.parse(toolCall.result?.content[0].text);

    expect(resourcePayload).toEqual(toolPayload);
    for (const payload of [resourcePayload, toolPayload]) {
      expect(payload.data).not.toHaveProperty('bodyTiptap');
      expect(payload.data).toMatchObject({
        body: '# Full body',
        updatedAt: '2026-08-02T00:00:00.000Z',
      });
    }
  });

  it('resolves prefixed-id URIs to the same API id as bare URIs', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: conventionResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    await client.request('resources/read', {
      uri: 'agentteams://convention/agentteams_cnv_conv-1',
      _meta: MODERN_META,
    });
    await client.request('resources/read', {
      uri: 'agentteams://convention/conv-1',
      _meta: MODERN_META,
    });

    const expectedUrl = `${apiUrl}/api/projects/${projectId}/conventions/conv-1`;
    expect(getSpy).toHaveBeenNthCalledWith(1, expectedUrl, { headers: TEST_TOOL_CONTEXT.headers });
    expect(getSpy).toHaveBeenNthCalledWith(2, expectedUrl, { headers: TEST_TOOL_CONTEXT.headers });
  });

  it('maps a 404 read to a JSON-RPC error, keeps the message, and keeps serving', async () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404, data: { message: 'Document not found' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(notFound as never);
    getSpy.mockResolvedValue({ data: documentResponse } as never);

    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const failed = await client.request('resources/read', {
      uri: 'agentteams://document/missing-doc',
      _meta: MODERN_META,
    });

    // Resources fail as JSON-RPC errors (not tool-style isError envelopes).
    expect(failed.result).toBeUndefined();
    expect(failed.error).toBeDefined();
    expect(failed.error?.message).toContain('Document not found');

    const recovered = await client.request('resources/read', {
      uri: 'agentteams://document/doc-1',
      _meta: MODERN_META,
    });

    expect(recovered.error).toBeUndefined();
    const recoveredPayload = JSON.parse(recovered.result?.contents[0].text);
    expect(recoveredPayload.data).not.toHaveProperty('bodyTiptap');
    expect(recoveredPayload.data).toMatchObject({
      id: 'doc-1',
      body: '# Full body',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('reads resources on the legacy path too', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: planRunbookResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await initializeLegacy(client);
    const read = await client.request('resources/read', { uri: 'agentteams://plan/agentteams_pln_plan-1' });

    expect(read.error).toBeUndefined();
    expect(read.result?.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(read.result?.contents[0].text)).toEqual(planRunbookResponse);
  });
});
