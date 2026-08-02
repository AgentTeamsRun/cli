import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getContextToolDefinitions } from '@agentteams/context-tools';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import axios from 'axios';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpToolContext } from '../src/commands/mcp.js';
import { connect, discover, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId, headers } = TEST_TOOL_CONTEXT;
const documentsUrl = `${apiUrl}/api/projects/${projectId}/documents`;
const KMA_PROJECT_ID = '78a24ae4-1816-4a04-8466-809686af9113';

const documentEnvelope = {
  data: {
    id: 'doc-1',
    title: '문서',
    updatedAt: '2026-08-01T00:00:00.000Z',
    webUrl: 'https://agentteams.run/go?type=document&id=doc-1',
  },
};

const WRITE_TOOL_NAMES = [
  'agentteams_guide_get',
  'agentteams_document_create',
  'agentteams_document_update',
  'agentteams_document_delete',
  'agentteams_comment_create',
  'agentteams_comment_update',
  'agentteams_comment_delete',
  'agentteams_comment_reply_create',
  'agentteams_comment_reply_update',
  'agentteams_comment_reply_delete',
];

describe('mcp write tools', () => {
  let openHandle: StdioServerHandle | undefined;
  let projectRoot = '';
  let originalCwd = '';

  beforeEach(() => {
    // agentteams_guide_get reads the guide from the project the process sits in.
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), 'agentteams-mcp-write-'));
    mkdirSync(join(projectRoot, '.agentteams', 'platform'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.agentteams', 'config.json'),
      JSON.stringify({ projectId, teamId: 'team-1' }),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'platform', 'document-guide.md'),
      '# Document Guide\n확정 태그는 직접 설정할 수 없다.\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'platform', 'comment-guide.md'),
      '# Comment Guide\n답글은 한 단계만 허용한다.\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'conventions.manifest.json'),
      JSON.stringify({
        version: 1,
        generatedAt: '2026-08-01T00:00:00.000Z',
        platformGuideHashes: { 'document-guide.md': 'doc-hash', 'comment-guide.md': 'comment-hash' },
        entries: [],
      }),
      'utf-8',
    );
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  // 실제 세션에서 프로젝트 루트는 cwd 탐색이 아니라 컨텍스트로 전달된다
  // (MCP 서버는 외부 에이전트가 띄우므로 cwd가 바인딩된 프로젝트 안이라고 신뢰할 수 없다).
  const boundContext = (): McpToolContext => ({ ...TEST_TOOL_CONTEXT, projectRoot });

  const callTool = async (name: string, args: Record<string, unknown>, context: McpToolContext = boundContext()) => {
    const { client, handle } = connect(context);
    openHandle = handle;
    await discover(client);
    return client.request('tools/call', { name, arguments: args, _meta: MODERN_META });
  };

  it('advertises exactly the document and comment write tools alongside the read surface', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const names = (response.result?.tools ?? []).map((tool: { name: string }) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    for (const writeTool of WRITE_TOOL_NAMES) {
      expect(names).toContain(writeTool);
    }
    // 3단계 이후 엔티티(플랜·보고서 등)의 쓰기 도구를 미리 만들지 않는다.
    const writeSuffixed = names.filter((name: string) => /_(create|update|delete)$/.test(name));
    expect(writeSuffixed.sort()).toEqual(
      [
        'agentteams_document_create',
        'agentteams_document_delete',
        'agentteams_document_update',
        'agentteams_comment_create',
        'agentteams_comment_delete',
        'agentteams_comment_update',
        'agentteams_comment_reply_create',
        'agentteams_comment_reply_delete',
        'agentteams_comment_reply_update',
      ].sort(),
    );
  });

  it('exposes no projectId argument on any write tool', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{ name: string; inputSchema?: Record<string, any> }>;

    for (const name of WRITE_TOOL_NAMES) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool).toBeDefined();
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('projectId');
    }
  });

  it('returns the local document guide body and its hash', async () => {
    const call = await callTool('agentteams_guide_get', { recordKind: 'document' });

    expect(call.result?.isError).toBeFalsy();
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.fileName).toBe('document-guide.md');
    expect(payload.source).toBe('local');
    expect(payload.guideHash).toBe('doc-hash');
    expect(payload.content).toContain('# Document Guide');
    expect(payload.warning).toBeUndefined();
  });

  it('ignores the cwd project when the session is bound elsewhere and reads the guide from the server', async () => {
    // cwd에 다른 프로젝트의 .agentteams가 있어도 그 프로젝트의 낡은 해시를 쓰면 안 된다.
    // 그 해시로 쓰면 GUIDE_OUTDATED가 나는데, 안내대로 convention download를 해도 해결되지 않는다.
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({
      data: { data: [{ fileName: 'document-guide.md', content: '# Server Guide\n', hash: 'server-hash' }] },
    } as never);

    const call = await callTool('agentteams_guide_get', { recordKind: 'document' }, TEST_TOOL_CONTEXT);

    expect(call.result?.isError).toBeFalsy();
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.source).toBe('server');
    expect(payload.guideHash).toBe('server-hash');
    expect(payload.content).toContain('# Server Guide');
    expect(payload.filePath).toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/platform/guides`, { headers });
  });

  it('warns instead of failing when the local guide hash is unknown', async () => {
    rmSync(join(projectRoot, '.agentteams', 'conventions.manifest.json'));

    const call = await callTool('agentteams_guide_get', { recordKind: 'document' });

    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.guideHash).toBeNull();
    expect(payload.warning).toMatch(/agentteams convention download/);
  });

  it('falls back to the server when the local guide file is missing', async () => {
    rmSync(join(projectRoot, '.agentteams', 'platform', 'document-guide.md'));
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: { data: [{ fileName: 'document-guide.md', content: '# Server Guide\n', hash: 'server-hash' }] },
    } as never);

    const call = await callTool('agentteams_guide_get', { recordKind: 'document' });

    expect(call.result?.isError).toBeFalsy();
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.source).toBe('server');
    expect(payload.guideHash).toBe('server-hash');
  });

  it('reports both fixes when neither the local copy nor the server can supply the guide', async () => {
    rmSync(join(projectRoot, '.agentteams', 'platform', 'document-guide.md'));
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('connect ECONNREFUSED') as never);

    const call = await callTool('agentteams_guide_get', { recordKind: 'document' });

    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(/agentteams convention download/);
    expect(call.result?.content[0].text).toMatch(/ECONNREFUSED/);
  });

  it('creates a document against the bound project and passes contract fields through', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: documentEnvelope } as never);

    const call = await callTool('agentteams_document_create', {
      title: '문서',
      body: '본문',
      suggestedTags: ['제안'],
      visibility: 'PROJECT',
      guideHash: 'doc-hash',
      idempotencyKey: 'key-1',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      documentsUrl,
      {
        title: '문서',
        body: '본문',
        suggestedTags: ['제안'],
        visibility: 'PROJECT',
        guideHash: 'doc-hash',
        idempotencyKey: 'key-1',
      },
      { headers },
    );
    // 성공 응답에는 문서 ID와 webUrl이 실린다.
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data.id).toBe('doc-1');
    expect(payload.data.webUrl).toContain('doc-1');
  });

  it('binds create to the MCP context project, not an argument', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: documentEnvelope } as never);
    const context = { ...TEST_TOOL_CONTEXT, projectId: KMA_PROJECT_ID };
    const { client, handle } = connect(context);
    openHandle = handle;

    await discover(client);
    await client.request('tools/call', {
      name: 'agentteams_document_create',
      arguments: { title: '문서', body: '본문' },
      _meta: MODERN_META,
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${KMA_PROJECT_ID}/documents`,
      { title: '문서', body: '본문' },
      { headers: context.headers },
    );
  });

  it('strips the document id prefix and forwards expectedUpdatedAt on update', async () => {
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: documentEnvelope } as never);

    await callTool('agentteams_document_update', {
      id: 'agentteams_doc_doc-1',
      title: '수정',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(putSpy).toHaveBeenCalledWith(
      `${documentsUrl}/doc-1`,
      { title: '수정', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      { headers },
    );
  });

  it('surfaces a server 409 as a tool error rather than killing the connection', async () => {
    jest.spyOn(axios, 'put').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: { errorCode: 'OPTIMISTIC_LOCK_CONFLICT', message: 'Document was updated by someone else' },
      },
    } as never);

    const call = await callTool('agentteams_document_update', {
      id: 'doc-1',
      title: '수정',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(/Conflict \(stale update\)/);
  });

  it('sends delete contract fields as query params and reports the deleted id', async () => {
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    const call = await callTool('agentteams_document_delete', {
      id: 'agentteams_doc_doc-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      // 삭제만 최신성 게이트가 빠지면 세 쓰기 중 되돌리기 가장 어려운 것에서 검사가 사라진다.
      guideHash: 'doc-hash',
      idempotencyKey: 'del-1',
    });

    expect(deleteSpy).toHaveBeenCalledWith(`${documentsUrl}/doc-1`, {
      headers: { 'X-API-Key': 'key_test' },
      params: {
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'doc-hash',
        idempotencyKey: 'del-1',
      },
    });
    expect(JSON.parse(call.result?.content[0].text)).toEqual({ deleted: true, id: 'doc-1' });
  });

  it('states the guide-first and tag policy rules in every document write tool description', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{ name: string; description: string }>;

    for (const name of ['agentteams_document_create', 'agentteams_document_update']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? '';
      expect(description).toContain('agentteams_guide_get');
      expect(description).toContain('confirmed tags');
    }

    const deleteDescription = tools.find((tool) => tool.name === 'agentteams_document_delete')?.description ?? '';
    expect(deleteDescription).toContain('destructive');
    expect(deleteDescription).toContain('unconditional delete');
    expect(deleteDescription).toContain('agentteams_guide_get');

    // 세 쓰기 도구 모두 같은 계약 필드를 받는다 — 표면이 비대칭이면 delete만 규칙이 느슨해 보인다.
    const withSchema = (response.result?.tools ?? []) as Array<{ name: string; inputSchema?: Record<string, any> }>;
    for (const name of ['agentteams_document_create', 'agentteams_document_update', 'agentteams_document_delete']) {
      const properties = withSchema.find((tool) => tool.name === name)?.inputSchema?.properties ?? {};
      expect(Object.keys(properties)).toEqual(expect.arrayContaining(['guideHash', 'idempotencyKey']));
    }
  });
  it('returns the local comment guide body and its hash', async () => {
    const call = await callTool('agentteams_guide_get', { recordKind: 'comment' });

    expect(call.result?.isError).toBeFalsy();
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.fileName).toBe('comment-guide.md');
    expect(payload.guideHash).toBe('comment-hash');
    expect(payload.content).toContain('답글은 한 단계만 허용한다');
  });

  it('routes each comment target to its own endpoint and carries the contract fields', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);
    const contract = { guideHash: 'comment-hash', idempotencyKey: 'key-1' };
    const base = `${apiUrl}/api/projects/${projectId}`;

    await callTool('agentteams_comment_create', {
      planId: 'agentteams_pln_plan-1',
      type: 'RISK',
      content: '위험',
      affectedFiles: ['api/src/index.ts'],
      ...contract,
    });
    await callTool('agentteams_comment_create', { taskId: 'agentteams_tsk_task-1', content: '태스크', ...contract });
    await callTool('agentteams_comment_create', {
      findingId: 'agentteams_rvf_finding-1',
      content: '파인딩',
      ...contract,
    });
    await callTool('agentteams_comment_create', { documentId: 'agentteams_doc_doc-1', content: '문서', ...contract });

    expect(postSpy.mock.calls.map((call) => call[0])).toEqual([
      `${base}/plans/plan-1/comments`,
      `${base}/plans/tasks/task-1/comments`,
      `${base}/code-reviews/findings/finding-1/comments`,
      `${base}/documents/doc-1/comments`,
    ]);
    expect(postSpy.mock.calls[0]?.[1]).toEqual({
      type: 'RISK',
      content: '위험',
      affectedFiles: ['api/src/index.ts'],
      ...contract,
    });
    // PLAN 전용 필드는 나머지 target 에 실리지 않는다.
    expect(postSpy.mock.calls[1]?.[1]).toEqual({ content: '태스크', ...contract });
  });

  it('rejects a create that names no target or more than one', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);

    const none = await callTool('agentteams_comment_create', { content: '부모 없음' });
    expect(none.result?.isError).toBe(true);

    const two = await callTool('agentteams_comment_create', {
      planId: 'plan-1',
      documentId: 'doc-1',
      type: 'GENERAL',
      content: '부모 둘',
    });
    expect(two.result?.isError).toBe(true);

    // 스키마 단계에서 걸러야 서버까지 가지 않는다.
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('keeps root comment ids and reply ids on separate tools', async () => {
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);
    const base = `${apiUrl}/api/projects/${projectId}`;

    await callTool('agentteams_comment_update', {
      commentId: 'comment-1',
      content: '수정',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'comment-hash',
    });
    await callTool('agentteams_comment_reply_update', {
      replyId: 'reply-1',
      content: '답글 수정',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(putSpy.mock.calls.map((call) => call[0])).toEqual([
      `${base}/comments/comment-1`,
      `${base}/comment-replies/reply-1`,
    ]);

    const deleted = await callTool('agentteams_comment_reply_delete', {
      replyId: 'reply-1',
      idempotencyKey: 'del-1',
    });
    expect(deleteSpy.mock.calls[0]?.[0]).toBe(`${base}/comment-replies/reply-1`);
    expect((deleteSpy.mock.calls[0]?.[1] as { params?: unknown })?.params).toEqual({ idempotencyKey: 'del-1' });
    expect(JSON.parse(deleted.result?.content[0].text)).toEqual({ deleted: true, id: 'reply-1' });

    // 반대로 답글 id 를 루트 도구에 넣는 실수는 스키마 이름부터 다르므로 인자가 거부된다.
    const wrongField = await callTool('agentteams_comment_update', { replyId: 'reply-1', content: '수정' });
    expect(wrongField.result?.isError).toBe(true);
  });

  it('states the guide-first, confirmation and contract rules in every comment write tool', async () => {
    const { client, handle } = connect(boundContext());
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{
      name: string;
      description: string;
      inputSchema?: Record<string, any>;
    }>;
    const commentWriteTools = [
      'agentteams_comment_create',
      'agentteams_comment_update',
      'agentteams_comment_delete',
      'agentteams_comment_reply_create',
      'agentteams_comment_reply_update',
      'agentteams_comment_reply_delete',
    ];

    for (const name of commentWriteTools) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toContain('agentteams_guide_get("comment")');
      // 계약 필드가 한 도구에서만 빠지면 그 표면의 멱등·최신성 검사가 조용히 사라진다.
      const schema = tool?.inputSchema ?? {};
      const properties = Object.keys(schema.properties ?? {});
      const unionProperties = (schema.anyOf ?? []).flatMap((branch: any) => Object.keys(branch.properties ?? {}));
      expect([...properties, ...unionProperties]).toEqual(expect.arrayContaining(['guideHash', 'idempotencyKey']));
    }

    for (const name of ['agentteams_comment_delete', 'agentteams_comment_reply_delete']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? '';
      expect(description).toContain('destructive');
      expect(description).toContain('unconditional delete');
      expect(description).toContain('Confirm with the user');
    }

    expect(tools.find((tool) => tool.name === 'agentteams_comment_delete')?.description).toContain(
      'every reply under it disappears',
    );
    expect(tools.find((tool) => tool.name === 'agentteams_comment_reply_create')?.description).toContain(
      'one level deep',
    );
  });
});

/**
 * Desktop's Direct BYOK runner advertises every context-tool definition without
 * filtering, so a write tool leaking into the shared package would silently
 * grant project write access to a `DESKTOP_LIMITED` conversation.
 */
describe('shared context-tools package stays read-only', () => {
  it('exposes no create/update/delete tool names', () => {
    const names = getContextToolDefinitions().map((definition) => definition.name);

    expect(names.filter((name) => /_(create|update|delete)$/.test(name))).toEqual([]);
    for (const writeTool of WRITE_TOOL_NAMES) {
      expect(names).not.toContain(writeTool);
    }
  });
});
