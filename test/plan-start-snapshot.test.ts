import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';
import httpClient from '../src/utils/httpClient.js';
import { executePlanCommand } from '../src/commands/plan.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};
const planId = 'f62762fc-730a-4201-8586-e2541505ed1b';

// plan-execution-guide는 `agentteams plan start --id {planId}`만 치라고 안내한다. 그 호출에서
// runnerType/model이 비면 WorkflowRun의 실행 의도 스냅샷이 항상 null로 남으므로, 러너 세션
// env를 폴백으로 읽는지 고정한다.
describe('plan start runner/model snapshot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTTEAMS_RUNNER_TYPE;
    delete process.env.AGENTTEAMS_MODEL;
    delete process.env.AGENTTEAMS_FAST_MODE;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const startWithoutFlags = () => executePlanCommand(apiUrl, projectId, headers, 'start', { id: planId, git: false });

  const mockPost = () => jest.spyOn(httpClient, 'post').mockResolvedValue({ data: { data: { id: planId } } } as never);

  it('fills runnerType/model from the runner session env when no flag is given', async () => {
    process.env.AGENTTEAMS_RUNNER_TYPE = 'CLAUDE_CODE';
    process.env.AGENTTEAMS_MODEL = 'claude-opus-5';
    process.env.AGENTTEAMS_FAST_MODE = 'true';
    const post = mockPost();

    await startWithoutFlags();

    expect(post).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/${planId}/start`,
      expect.objectContaining({ runnerType: 'CLAUDE_CODE', model: 'claude-opus-5', fastMode: true }),
      { headers },
    );
  });

  it('lets an explicit flag win over the session env', async () => {
    process.env.AGENTTEAMS_RUNNER_TYPE = 'CLAUDE_CODE';
    process.env.AGENTTEAMS_MODEL = 'claude-opus-5';
    const post = mockPost();

    await executePlanCommand(apiUrl, projectId, headers, 'start', {
      id: planId,
      runnerType: 'CODEX',
      model: 'gpt-5',
      git: false,
    });

    expect(post).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/${planId}/start`,
      expect.objectContaining({ runnerType: 'CODEX', model: 'gpt-5' }),
      { headers },
    );
  });

  // 러너 밖(사람이 로컬에서 직접 시작)에서는 채울 값이 없다. 필드를 생략하던 기존 동작을
  // 유지해야 하며, 여기서 새로 실패하면 안 된다.
  it('omits the fields outside a runner session instead of failing', async () => {
    const post = mockPost();

    await startWithoutFlags();

    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('runnerType');
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('fastMode');
  });
});
