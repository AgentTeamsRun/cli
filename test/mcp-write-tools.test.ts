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
    // 실제 API는 쓰기 응답에도 에디터 전용 미러를 싣는다. 픽스처가 이를 빼면
    // "응답에서 제외한다"는 계약을 테스트가 전혀 검증하지 못한다.
    body: '본문',
    bodyTiptap: '{"type":"doc","content":[]}',
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
  'agentteams_coaction_create',
  'agentteams_coaction_update',
  'agentteams_coaction_delete',
  'agentteams_postmortem_create',
  'agentteams_postmortem_update',
  'agentteams_codereview_create',
  'agentteams_codereview_update',
  'agentteams_codereview_finding_status_set',
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
      join(projectRoot, '.agentteams', 'platform', 'co-action-guide.md'),
      '# Co-Action Guide\n핸드오프 기록.\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'platform', 'post-mortem-guide.md'),
      '# Post-Mortem Guide\n재현 가능한 실패만.\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'platform', 'code-review-guide.md'),
      '# Code Review Guide\n검토 가이드.\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, '.agentteams', 'conventions.manifest.json'),
      JSON.stringify({
        version: 1,
        generatedAt: '2026-08-01T00:00:00.000Z',
        platformGuideHashes: {
          'document-guide.md': 'doc-hash',
          'comment-guide.md': 'comment-hash',
          'co-action-guide.md': 'co-action-hash',
          'post-mortem-guide.md': 'post-mortem-hash',
          'code-review-guide.md': 'code-review-hash',
        },
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

  it('advertises document, comment, co-action, and post-mortem write tools alongside the read surface', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const names = (response.result?.tools ?? []).map((tool: { name: string }) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    for (const writeTool of WRITE_TOOL_NAMES) {
      expect(names).toContain(writeTool);
    }
    const writeSuffixed = names.filter((name: string) => /_(create|update|delete|set)$/.test(name));
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
        'agentteams_coaction_create',
        'agentteams_coaction_update',
        'agentteams_coaction_delete',
        'agentteams_postmortem_create',
        'agentteams_postmortem_update',
        'agentteams_codereview_create',
        'agentteams_codereview_update',
        'agentteams_codereview_finding_status_set',
      ].sort(),
    );
    expect(names).not.toContain('agentteams_postmortem_delete');
    expect(names).not.toContain('agentteams_codereview_delete');
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

  it('returns the local co-action and post-mortem guides with their hashes', async () => {
    const coAction = await callTool('agentteams_guide_get', { recordKind: 'co-action' });
    expect(coAction.result?.isError).toBeFalsy();
    const coActionPayload = JSON.parse(coAction.result?.content[0].text);
    expect(coActionPayload.fileName).toBe('co-action-guide.md');
    expect(coActionPayload.guideHash).toBe('co-action-hash');
    expect(coActionPayload.content).toContain('# Co-Action Guide');

    const postMortem = await callTool('agentteams_guide_get', { recordKind: 'post-mortem' });
    expect(postMortem.result?.isError).toBeFalsy();
    const postMortemPayload = JSON.parse(postMortem.result?.content[0].text);
    expect(postMortemPayload.fileName).toBe('post-mortem-guide.md');
    expect(postMortemPayload.guideHash).toBe('post-mortem-hash');
    expect(postMortemPayload.content).toContain('# Post-Mortem Guide');

    const codeReview = await callTool('agentteams_guide_get', { recordKind: 'code-review' });
    expect(codeReview.result?.isError).toBeFalsy();
    const codeReviewPayload = JSON.parse(codeReview.result?.content[0].text);
    expect(codeReviewPayload.fileName).toBe('code-review-guide.md');
    expect(codeReviewPayload.guideHash).toBe('code-review-hash');
    expect(codeReviewPayload.content).toContain('# Code Review Guide');
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

  // 이 계약은 예전에 최상위 union 이 지켰지만, union input_schema 를 400 으로 거부하는
  // 백엔드가 있어 스키마를 평탄화했다. 계약은 핸들러 검증으로 옮겼으므로 여기서 고정한다.
  it('rejects a create that names no target or more than one', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);

    const none = await callTool('agentteams_comment_create', { content: '부모 없음' });
    expect(none.result?.isError).toBe(true);
    expect(none.result?.content[0].text).toContain('needs a parent');

    const two = await callTool('agentteams_comment_create', {
      planId: 'plan-1',
      documentId: 'doc-1',
      type: 'GENERAL',
      content: '부모 둘',
    });
    expect(two.result?.isError).toBe(true);
    // 무엇이 충돌했는지 오류에 드러나야 모델이 다음 호출을 고칠 수 있다.
    expect(two.result?.content[0].text).toContain('planId, documentId');

    // 서버까지 가지 않아야 한다.
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('states that taskId and planId cannot be paired when creating a comment', async () => {
    const { client, handle } = connect(boundContext());
    openHandle = handle;
    await discover(client);

    const response = await client.request('tools/list', { _meta: MODERN_META });
    const description = (response.result?.tools ?? []).find(
      (tool: { name: string }) => tool.name === 'agentteams_comment_create',
    )?.description;

    expect(description).toContain('Do not pair taskId with planId when creating a comment');
  });

  it('keeps the plan-only fields plan-only after the schema was flattened', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);

    // 평탄화로 type 이 스키마상 optional 이 되었으므로 plan 코멘트의 필수 조건은 런타임이 지킨다.
    const untypedPlan = await callTool('agentteams_comment_create', { planId: 'plan-1', content: '타입 없음' });
    expect(untypedPlan.result?.isError).toBe(true);
    expect(untypedPlan.result?.content[0].text).toContain('requires type');

    const typedTask = await callTool('agentteams_comment_create', {
      taskId: 'task-1',
      type: 'RISK',
      content: '태스크에 타입',
    });
    expect(typedTask.result?.isError).toBe(true);
    expect(typedTask.result?.content[0].text).toContain('only accepts type with planId');

    const filedDocument = await callTool('agentteams_comment_create', {
      documentId: 'doc-1',
      affectedFiles: ['api/src/index.ts'],
      content: '문서에 파일',
    });
    expect(filedDocument.result?.isError).toBe(true);
    expect(filedDocument.result?.content[0].text).toContain('only accepts affectedFiles with planId');

    expect(postSpy).not.toHaveBeenCalled();
  });

  // Kiro 의 Bedrock 백엔드는 최상위 union input_schema 를 400 으로 거부하고 그 400 이 대화
  // 전체를 죽인다. 쓰기 표면에 union 이 다시 생기면 그 클라이언트가 다시 브릭된다.
  it('publishes every advertised tool with an object root, never a top-level union', async () => {
    const { client, handle } = connect(boundContext());
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{ name: string; inputSchema?: Record<string, any> }>;

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema).not.toHaveProperty('anyOf');
      expect(tool.inputSchema).not.toHaveProperty('oneOf');
      expect(tool.inputSchema?.type).toBe('object');
    }
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

  // 조회와 같은 규칙을 쓰기 응답에도 적용한다. 한쪽만 걷어내면 "읽기는 되는데
  // 수정 응답에서 한도를 넘는" 비대칭이 남는다(실측 update 응답 65,297자).
  it('omits bodyTiptap from the create response while keeping the write contract fields', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({ data: documentEnvelope } as never);

    const call = await callTool('agentteams_document_create', { title: '문서', body: '본문' });

    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data).not.toHaveProperty('bodyTiptap');
    expect(payload.data).toMatchObject({
      id: 'doc-1',
      body: '본문',
      updatedAt: '2026-08-01T00:00:00.000Z',
      webUrl: 'https://agentteams.run/go?type=document&id=doc-1',
    });
  });

  it('omits bodyTiptap from the update response and keeps updatedAt for the next expectedUpdatedAt', async () => {
    jest.spyOn(axios, 'put').mockResolvedValue({ data: documentEnvelope } as never);

    const call = await callTool('agentteams_document_update', { id: 'doc-1', title: '수정' });

    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data).not.toHaveProperty('bodyTiptap');
    expect(payload.data.updatedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('creates a traceable co-action without exposing source or projectId and returns id plus webUrl', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'act-1',
          status: 'OPEN',
          webUrl: 'https://agentteams.run/go?type=co-action&id=act-1',
        },
      },
    } as never);

    const call = await callTool('agentteams_coaction_create', {
      title: '핸드오프',
      content: '본문',
      planId: 'agentteams_pln_plan-1',
      status: 'OPEN',
      visibility: 'PROJECT',
      guideHash: 'co-action-hash',
      idempotencyKey: 'coa-1',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/co-actions`,
      {
        title: '핸드오프',
        content: '본문',
        planId: 'plan-1',
        status: 'OPEN',
        visibility: 'PROJECT',
        guideHash: 'co-action-hash',
        idempotencyKey: 'coa-1',
      },
      { headers },
    );
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data.id).toBe('act-1');
    expect(payload.data.webUrl).toContain('act-1');
  });

  it('rejects co-action create without a traceability target and update without a mutable field', async () => {
    const orphan = await callTool('agentteams_coaction_create', {
      title: '고아 코액션',
      content: '추적 링크 없음',
    });
    expect(orphan.result?.isError).toBe(true);
    expect(orphan.result?.content[0].text).toMatch(/planId|completionReportId|postMortemId/);

    const noOp = await callTool('agentteams_coaction_update', {
      id: 'act-1',
      guideHash: 'co-action-hash',
    });
    expect(noOp.result?.isError).toBe(true);
    expect(noOp.result?.content[0].text).toMatch(/title|content|status|visibility/);
  });

  it('transitions co-action status and surfaces a 403 instead of swallowing it', async () => {
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({
      data: {
        data: {
          id: 'act-1',
          status: 'CLOSED',
          webUrl: 'https://agentteams.run/go?type=co-action&id=act-1',
        },
      },
    } as never);

    const updated = await callTool('agentteams_coaction_update', {
      id: 'agentteams_act_act-1',
      status: 'CLOSED',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(putSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/co-actions/act-1`,
      { status: 'CLOSED', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      { headers },
    );
    expect(JSON.parse(updated.result?.content[0].text).data.status).toBe('CLOSED');

    await openHandle?.close();
    openHandle = undefined;
    jest.spyOn(axios, 'put').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 403,
        data: { errorCode: 'FORBIDDEN', errorDetailCode: 'CO_ACTION_RUNNER_SOURCE_WRITE_DENIED' },
      },
    } as never);

    const denied = await callTool('agentteams_coaction_update', { id: 'act-2', title: '수정' });
    expect(denied.result?.isError).toBe(true);
    expect(denied.result?.content[0].text).toMatch(/Forbidden/);
  });

  it('sends co-action delete contract fields as query params', async () => {
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    const call = await callTool('agentteams_coaction_delete', {
      id: 'agentteams_act_act-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'co-action-hash',
      idempotencyKey: 'del-1',
    });

    expect(deleteSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/co-actions/act-1`, {
      headers: { 'X-API-Key': 'key_test' },
      params: {
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'co-action-hash',
        idempotencyKey: 'del-1',
      },
    });
    expect(JSON.parse(call.result?.content[0].text)).toEqual({ deleted: true, id: 'act-1' });
  });

  it('supports standalone and plan-linked post-mortem create while forwarding contract fields', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'pmt-standalone',
          webUrl: 'https://agentteams.run/go?type=post-mortem&id=pmt-standalone',
        },
      },
    } as never);
    const standalone = await callTool('agentteams_postmortem_create', {
      title: '사후분석',
      content: '## 사후분석 테스트\n- 재현 가능한 실패가 작업을 유의미하게 지연시켰고 예방 가능한 원인이 있다',
      actionItems: ['재발 방지'],
    });
    expect(standalone.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenLastCalledWith(
      `${apiUrl}/api/projects/${projectId}/post-mortems`,
      {
        title: '사후분석',
        content: '## 사후분석 테스트\n- 재현 가능한 실패가 작업을 유의미하게 지연시켰고 예방 가능한 원인이 있다',
        actionItems: ['재발 방지'],
      },
      { headers },
    );

    postSpy.mockResolvedValue({
      data: {
        data: {
          id: 'pmt-1',
          webUrl: 'https://agentteams.run/go?type=post-mortem&id=pmt-1',
        },
      },
    } as never);
    const call = await callTool('agentteams_postmortem_create', {
      planId: 'agentteams_pln_plan-1',
      title: '사후분석',
      content: '## 사후분석 테스트\n- 재현 가능한 실패가 작업을 유의미하게 지연시켰고 예방 가능한 원인이 있다',
      actionItems: ['재발 방지'],
      guideHash: 'post-mortem-hash',
      idempotencyKey: 'pm-1',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/post-mortems`,
      {
        planId: 'plan-1',
        title: '사후분석',
        content: '## 사후분석 테스트\n- 재현 가능한 실패가 작업을 유의미하게 지연시켰고 예방 가능한 원인이 있다',
        actionItems: ['재발 방지'],
        guideHash: 'post-mortem-hash',
        idempotencyKey: 'pm-1',
      },
      { headers },
    );
    const payload = JSON.parse(call.result?.content[0].text);
    expect(payload.data.id).toBe('pmt-1');
    expect(payload.data.webUrl).toContain('pmt-1');
  });

  it('rejects post-mortem update without a mutable field', async () => {
    const noOp = await callTool('agentteams_postmortem_update', {
      id: 'pmt-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(noOp.result?.isError).toBe(true);
    expect(noOp.result?.content[0].text).toMatch(/title|content|actionItems|status/);
  });

  it('rejects a stale post-mortem update without swallowing the 409', async () => {
    jest.spyOn(axios, 'put').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: { errorCode: 'OPTIMISTIC_LOCK_CONFLICT', errorDetailCode: 'POST_MORTEM_UPDATE_CONFLICT' },
      },
    } as never);

    const call = await callTool('agentteams_postmortem_update', {
      id: 'pmt-1',
      title: '수정',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(/Conflict|409|OPTIMISTIC_LOCK_CONFLICT/);
  });

  it('states guide-first and project-scope rules on the new write tools and hides source', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{
      name: string;
      description: string;
      inputSchema?: Record<string, any>;
    }>;

    for (const name of ['agentteams_coaction_create', 'agentteams_coaction_update', 'agentteams_coaction_delete']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toContain('agentteams_guide_get("co-action")');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('projectId');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('source');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual(
        expect.arrayContaining(['guideHash', 'idempotencyKey']),
      );
    }

    const deleteDescription = tools.find((tool) => tool.name === 'agentteams_coaction_delete')?.description ?? '';
    expect(deleteDescription).toContain('destructive');
    expect(deleteDescription).toContain('unconditional delete');
    expect(deleteDescription).toContain('Confirm with the user');

    for (const name of ['agentteams_postmortem_create', 'agentteams_postmortem_update']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toContain('agentteams_guide_get("post-mortem")');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('projectId');
    }
    const postMortemCreateRequired =
      tools.find((tool) => tool.name === 'agentteams_postmortem_create')?.inputSchema?.required ?? [];
    expect(postMortemCreateRequired).toEqual(expect.arrayContaining(['title', 'content', 'actionItems']));
    expect(postMortemCreateRequired).not.toContain('planId');

    for (const name of [
      'agentteams_codereview_create',
      'agentteams_codereview_update',
      'agentteams_codereview_finding_status_set',
    ]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toContain('agentteams_guide_get("code-review")');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).not.toContain('projectId');
      expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual(
        expect.arrayContaining(['guideHash', 'idempotencyKey']),
      );
    }
  });

  it('creates a code review with optional findings and forwards contract fields', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'crv-1',
          status: 'OPEN',
          webUrl: 'https://agentteams.run/go?type=code-review&id=crv-1',
        },
      },
    } as never);

    const call = await callTool('agentteams_codereview_create', {
      title: 'Local diff review',
      targetType: 'LOCAL_DIFF',
      sourcePlanId: 'agentteams_pln_p-1',
      runnerType: 'CODEX',
      model: 'gpt-5.6-sol',
      resultSummary:
        '**Mergeable after fixes** — P0 0 / P1 1 / P2 0 / P3 1.\n\nMalformed inputs can crash the service.\n\n- Add the missing input validation.\n- Clarify the legacy boundary.',
      findings: [
        {
          severity: 'P1',
          impactArea: 'CONTRACT',
          title: 'Missing input validation',
          filePath: 'src/api.ts',
          lineStart: 10,
          lineEnd: 20,
          problem: 'No validation on input',
          impact: 'Malformed input crashes service',
          suggestion: 'Add Zod schema',
        },
        {
          severity: 'P3',
          impactArea: 'OTHER',
          title: 'Unclassified maintainability issue',
          filePath: 'src/legacy.ts',
          problem: 'The issue does not fit a more specific impact area',
          impact: 'Future changes are harder to review',
          suggestion: 'Clarify the legacy boundary',
        },
      ],
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-create-key',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews`,
      {
        title: 'Local diff review',
        targetType: 'LOCAL_DIFF',
        sourcePlanId: 'p-1',
        runnerType: 'CODEX',
        model: 'gpt-5.6-sol',
        resultSummary:
          '**Mergeable after fixes** — P0 0 / P1 1 / P2 0 / P3 1.\n\nMalformed inputs can crash the service.\n\n- Add the missing input validation.\n- Clarify the legacy boundary.',
        findings: [
          {
            severity: 'P1',
            impactArea: 'CONTRACT',
            title: 'Missing input validation',
            filePath: 'src/api.ts',
            lineStart: 10,
            lineEnd: 20,
            problem: 'No validation on input',
            impact: 'Malformed input crashes service',
            suggestion: 'Add Zod schema',
          },
          {
            severity: 'P3',
            impactArea: 'OTHER',
            title: 'Unclassified maintainability issue',
            filePath: 'src/legacy.ts',
            problem: 'The issue does not fit a more specific impact area',
            impact: 'Future changes are harder to review',
            suggestion: 'Clarify the legacy boundary',
          },
        ],
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-create-key',
      },
      { headers },
    );
    expect(JSON.parse(call.result?.content[0].text)).toEqual({
      data: {
        id: 'crv-1',
        status: 'OPEN',
        webUrl: 'https://agentteams.run/go?type=code-review&id=crv-1',
      },
    });
  });

  it('requires the code review finding impactArea enum in the MCP schema', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{
      name: string;
      inputSchema?: {
        properties?: {
          findings?: {
            items?: {
              properties?: Record<string, { enum?: string[] }>;
              required?: string[];
            };
          };
        };
      };
    }>;
    const findingSchema = tools.find((tool) => tool.name === 'agentteams_codereview_create')?.inputSchema?.properties
      ?.findings?.items;

    expect(findingSchema?.required).toContain('impactArea');
    expect(findingSchema?.properties?.impactArea?.enum).toEqual([
      'UI',
      'BUSINESS_RULE',
      'CONTRACT',
      'DATA',
      'SECURITY',
      'OPS',
      'DOCS',
      'TEST',
      'OTHER',
    ]);
  });

  it('uses the API target type contract for code review create and update', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{
      name: string;
      inputSchema?: { properties?: Record<string, { enum?: string[] }> };
    }>;
    const expectedTargetTypes = [
      'BRANCH_DIFF',
      'GITHUB_PR',
      'GITLAB_MR',
      'BITBUCKET_PR',
      'LOCAL_DIFF',
      'UPLOADED_DIFF',
      'COMMIT_RANGE',
    ];

    for (const name of ['agentteams_codereview_create', 'agentteams_codereview_update']) {
      expect(tools.find((tool) => tool.name === name)?.inputSchema?.properties?.targetType?.enum).toEqual(
        expectedTargetTypes,
      );
    }
  });

  it('rejects initial findings without runnerType and model before calling the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');

    const call = await callTool('agentteams_codereview_create', {
      title: 'Incomplete review snapshot',
      findings: [
        {
          severity: 'P1',
          impactArea: 'CONTRACT',
          title: 'Finding',
          filePath: 'src/api.ts',
          problem: 'Problem',
          impact: 'Impact',
          suggestion: 'Suggestion',
        },
      ],
    });

    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(/runnerType.*model|model.*runnerType/);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects an initial resultSummary without findings before calling the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');

    const call = await callTool('agentteams_codereview_create', {
      title: 'Summary without findings',
      runnerType: 'CODEX',
      model: 'gpt-5.6-sol',
      resultSummary: '**Mergeable** — P0 0 / P1 0 / P2 0 / P3 0.',
    });

    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(/requires findings when resultSummary is provided/);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('updates code review metadata and forwards expectedUpdatedAt', async () => {
    const patchSpy = jest.spyOn(axios, 'patch').mockResolvedValue({
      data: {
        data: {
          id: 'crv-1',
          status: 'OPEN',
          webUrl: 'https://agentteams.run/go?type=code-review&id=crv-1',
        },
      },
    } as never);

    const call = await callTool('agentteams_codereview_update', {
      id: 'agentteams_rev_crv-1',
      diffSummary: 'Updated diff summary',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-update-key',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(patchSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews/crv-1`,
      {
        diffSummary: 'Updated diff summary',
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-update-key',
      },
      { headers },
    );
  });

  it('cancels a pending code review when status CANCELLED is passed', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'crv-1',
          status: 'CANCELLED',
        },
      },
    } as never);

    const call = await callTool('agentteams_codereview_update', {
      id: 'agentteams_rev_crv-1',
      status: 'CANCELLED',
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-cancel-key',
    });

    expect(call.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews/crv-1/cancel`,
      {
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-cancel-key',
      },
      { headers },
    );
  });

  it('rejects cancellation mixed with optimistic locking or metadata before calling the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');

    for (const input of [
      { status: 'CANCELLED', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      { status: 'CANCELLED', title: 'Silently discarded title' },
    ]) {
      const call = await callTool('agentteams_codereview_update', {
        id: 'crv-1',
        ...input,
      });
      expect(call.result?.isError).toBe(true);
      expect(call.result?.content[0].text).toMatch(/CANCELLED/);
    }

    expect(postSpy).not.toHaveBeenCalled();
  });

  it('transitions finding status (dismiss, undismiss, resolve) with expectedUpdatedAt', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'crv-1',
          status: 'OPEN',
        },
      },
    } as never);

    // 1. DISMISSED
    const dismissCall = await callTool('agentteams_codereview_finding_status_set', {
      codeReviewId: 'agentteams_rev_crv-1',
      findingId: 'agentteams_rvf_f-1',
      status: 'DISMISSED',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-dismiss-key',
    });
    expect(dismissCall.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews/crv-1/findings/f-1/dismiss`,
      {
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-dismiss-key',
      },
      { headers },
    );

    // 2. OPEN
    const undismissCall = await callTool('agentteams_codereview_finding_status_set', {
      codeReviewId: 'agentteams_rev_crv-1',
      findingId: 'agentteams_rvf_f-1',
      status: 'OPEN',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-undismiss-key',
    });
    expect(undismissCall.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews/crv-1/findings/f-1/undismiss`,
      {
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-undismiss-key',
      },
      { headers },
    );

    // 3. RESOLVED
    const resolveCall = await callTool('agentteams_codereview_finding_status_set', {
      codeReviewId: 'agentteams_rev_crv-1',
      findingId: 'agentteams_rvf_f-1',
      status: 'RESOLVED',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      guideHash: 'code-review-hash',
      idempotencyKey: 'crv-resolve-key',
    });
    expect(resolveCall.result?.isError).toBeFalsy();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/code-reviews/crv-1/findings/f-1/resolve`,
      {
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
        guideHash: 'code-review-hash',
        idempotencyKey: 'crv-resolve-key',
      },
      { headers },
    );
  });

  it('leaves the delete acknowledgement shape unchanged', async () => {
    jest.spyOn(axios, 'delete').mockResolvedValue({ data: {} } as never);

    const call = await callTool('agentteams_document_delete', { id: 'agentteams_doc_doc-1' });

    // 삭제는 본문을 싣지 않으므로 걷어낼 대상이 없다. 계약이 바뀌지 않았음을 고정한다.
    expect(JSON.parse(call.result?.content[0].text)).toEqual({ deleted: true, id: 'doc-1' });
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
