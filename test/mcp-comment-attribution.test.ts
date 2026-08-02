import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import axios from 'axios';
import type { McpToolContext } from '../src/commands/mcp.js';
import { AGENT_NAME_ENV, resolveSessionAgentConfigId } from '../src/utils/agentIdentity.js';
import { connect, discover, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId } = TEST_TOOL_CONTEXT;
const base = `${apiUrl}/api/projects/${projectId}`;
const AGENT_CONFIG_ID = 'agent-config-1';

describe('resolveSessionAgentConfigId', () => {
  it('reads the agentConfigId the daemon exported', () => {
    expect(resolveSessionAgentConfigId({ [AGENT_NAME_ENV]: AGENT_CONFIG_ID })).toBe(AGENT_CONFIG_ID);
  });

  it('is undefined outside a daemon session, and treats an empty value as absent', () => {
    expect(resolveSessionAgentConfigId({})).toBeUndefined();
    expect(resolveSessionAgentConfigId({ [AGENT_NAME_ENV]: '' })).toBeUndefined();
    expect(resolveSessionAgentConfigId({ [AGENT_NAME_ENV]: '   ' })).toBeUndefined();
  });
});

describe('mcp comment writes declare the session agent config', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  const callTool = async (name: string, args: Record<string, unknown>, context: McpToolContext) => {
    const { client, handle } = connect(context);
    openHandle = handle;
    await discover(client);
    return client.request('tools/call', { name, arguments: args, _meta: MODERN_META });
  };

  const createEveryCommentSurface = async (context: McpToolContext) => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { id: 'comment-1' } } } as never);

    await callTool('agentteams_comment_create', { planId: 'plan-1', type: 'GENERAL', content: '플랜' }, context);
    await callTool('agentteams_comment_create', { taskId: 'task-1', content: '태스크' }, context);
    await callTool('agentteams_comment_create', { findingId: 'finding-1', content: '파인딩' }, context);
    await callTool('agentteams_comment_create', { documentId: 'doc-1', content: '문서' }, context);
    await callTool('agentteams_comment_reply_create', { commentId: 'comment-1', content: '답글' }, context);

    expect(postSpy.mock.calls.map((call) => call[0])).toEqual([
      `${base}/plans/plan-1/comments`,
      `${base}/plans/tasks/task-1/comments`,
      `${base}/code-reviews/findings/finding-1/comments`,
      `${base}/documents/doc-1/comments`,
      `${base}/comments/comment-1/replies`,
    ]);
    return postSpy.mock.calls.map((call) => call[1] as Record<string, unknown>);
  };

  it('carries agentConfigId on all five comment write surfaces when the daemon spawned the session', async () => {
    const bodies = await createEveryCommentSurface({ ...TEST_TOOL_CONTEXT, agentConfigId: AGENT_CONFIG_ID });

    for (const body of bodies) {
      expect(body.agentConfigId).toBe(AGENT_CONFIG_ID);
    }
  });

  // 값이 없을 때 빈 문자열이나 placeholder 를 보내면 서버가 소유권 검증에서 403 으로 떨군다.
  // 키 자체가 없어야 기존 동작(도구 축 없음)이 그대로 유지된다.
  it('omits the key entirely outside a daemon session', async () => {
    const bodies = await createEveryCommentSurface({ ...TEST_TOOL_CONTEXT });

    for (const body of bodies) {
      expect(body).not.toHaveProperty('agentConfigId');
    }
    expect(bodies[0]).toEqual({ type: 'GENERAL', content: '플랜' });
    expect(bodies[4]).toEqual({ content: '답글' });
  });

  // 도구 축은 세션의 속성이지 모델이 고르는 값이 아니다. 입력 스키마에 노출하면
  // 모델이 남의 에이전트 설정 ID를 주장할 수 있는 표면이 생긴다(서버가 막긴 하지만 열어 둘 이유가 없다).
  it('exposes no agentConfigId argument on any comment write tool', async () => {
    const { client, handle } = connect({ ...TEST_TOOL_CONTEXT, agentConfigId: AGENT_CONFIG_ID });
    openHandle = handle;

    await discover(client);
    const response = await client.request('tools/list', { _meta: MODERN_META });
    const tools = (response.result?.tools ?? []) as Array<{ name: string; inputSchema?: Record<string, any> }>;

    for (const name of ['agentteams_comment_create', 'agentteams_comment_reply_create']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool).toBeDefined();
      expect(JSON.stringify(tool?.inputSchema ?? {})).not.toContain('agentConfigId');
    }
  });
});
