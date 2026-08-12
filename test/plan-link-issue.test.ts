import { describe, it, expect, jest, afterEach } from '@jest/globals';
import httpClient from '../src/utils/httpClient.js';
import { executePlanCommand } from '../src/commands/plan.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};

const linkOptions = {
  id: 'f62762fc-730a-4201-8586-e2541505ed1b',
  provider: 'github',
  externalId: '2021',
  externalUrl: 'https://github.com/rlarua/AgentTeams/issues/2021',
};

function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('plan link-issue', () => {
  it('posts the origin issue with a normalized provider', async () => {
    const post = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: { data: { id: 'issue-1' } } } as never);

    const result = await executePlanCommand(apiUrl, projectId, headers, 'link-issue', linkOptions);

    expect(result).toEqual({ data: { id: 'issue-1' } });
    expect(post).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/${linkOptions.id}/origin-issues`,
      expect.objectContaining({ provider: 'GITHUB', externalId: '2021' }),
      { headers },
    );
  });

  // 러너의 origin-issue 세이프가드는 재실행될 수 있습니다. 이미 연결된 상태(409)를
  // 실패로 남기면 매 실행마다 경고가 쌓이므로 성공 메시지로 접습니다.
  it('folds a 409 conflict into an idempotent success message', async () => {
    jest.spyOn(httpClient, 'post').mockRejectedValue(httpError(409) as never);

    await expect(executePlanCommand(apiUrl, projectId, headers, 'link-issue', linkOptions)).resolves.toEqual({
      message: 'Origin issue already linked (skipped)',
    });
  });

  it('still surfaces non-409 failures', async () => {
    jest.spyOn(httpClient, 'post').mockRejectedValue(httpError(500) as never);

    await expect(executePlanCommand(apiUrl, projectId, headers, 'link-issue', linkOptions)).rejects.toThrow(
      /status code 500/,
    );
  });
});
