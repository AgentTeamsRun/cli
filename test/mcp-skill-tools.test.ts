import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { connect, discover, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;
const skillsUrl = `${apiUrl}/api/projects/${projectId}/skills`;

const listEnvelope = {
  data: [
    {
      id: 'skill-1',
      slug: 'test-skill',
      title: 'Testing Skill',
      description: 'Skill for testing MCP wiring',
      scope: 'PROJECT',
      version: '1.0.0',
      files: [{ relativePath: 'SKILL.md', sizeBytes: 100, sha256: 'abc' }],
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
  ],
  meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
};

const detailEnvelope = {
  data: {
    id: 'skill-1',
    projectId,
    slug: 'test-skill',
    title: 'Testing Skill',
    description: 'Skill for testing MCP wiring',
    memberId: 'member-1',
    scope: 'PROJECT',
    version: '1.0.0',
    files: [{ relativePath: 'SKILL.md', sizeBytes: 100, sha256: 'abc' }],
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    repositoryId: null,
    archivedAt: null,
  },
};

describe('mcp skill tools', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('exposes agentteams_skill_list and agentteams_skill_get in MCP tool catalog', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const list = await client.request('tools/list', { _meta: MODERN_META });
    const tools = list.result?.tools ?? [];
    const names = tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('agentteams_skill_list');
    expect(names).toContain('agentteams_skill_get');

    for (const name of ['agentteams_skill_list', 'agentteams_skill_get']) {
      const tool = tools.find((entry: { name: string; description?: string }) => entry.name === name);
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('agentteams_search');
    }
  });

  it('passes list filters through to GET /skills', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: listEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_skill_list',
      arguments: {
        scope: 'PROJECT',
        repositoryId: 'repo-1',
        search: 'testing',
        legacyConventionId: 'agentteams_cnv_conv-1',
        page: 1,
        pageSize: 20,
      },
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    expect(getSpy).toHaveBeenCalledWith(skillsUrl, {
      headers: TEST_TOOL_CONTEXT.headers,
      params: {
        scope: 'PROJECT',
        repositoryId: 'repo-1',
        search: 'testing',
        legacyConventionId: 'conv-1',
        page: 1,
        pageSize: 20,
      },
    });
    expect(JSON.parse(call.result?.content[0].text)).toEqual(listEnvelope);
  });

  it('skill_get calls GET /skills/:id with bare id', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: detailEnvelope } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const call = await client.request('tools/call', {
      name: 'agentteams_skill_get',
      arguments: { id: 'skill-1' },
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    expect(getSpy).toHaveBeenCalledWith(`${skillsUrl}/skill-1`, {
      headers: TEST_TOOL_CONTEXT.headers,
    });
    expect(JSON.parse(call.result?.content[0].text)).toEqual(detailEnvelope);
  });
});
