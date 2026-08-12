import { describe, expect, it, jest } from '@jest/globals';

/** The built-in default origin, seeded by `utils/apiOrigin.ts` without any config lookup. */
const API_URL = 'https://api.agentteams.run';

/**
 * The session identity headers are resolved once per process and cached, so each case here loads a
 * fresh module registry with its own machineId / project-root stubs.
 */
const loadInterceptor = async (stubs: { machineId: string | null; projectRootHash: string | null }) => {
  jest.resetModules();

  jest.unstable_mockModule('../src/utils/machineId.js', () => ({
    readOrCreateMachineId: () => stubs.machineId,
    getMachineIdPath: () => '/tmp/machine-id',
  }));
  jest.unstable_mockModule('../src/utils/projectRootHash.js', () => ({
    resolveProjectRootHash: () => stubs.projectRootHash,
    hashProjectRootPath: (value: string) => value,
    normalizeProjectRootPath: (value: string) => value,
  }));

  const axiosModule = await import('axios');
  const handlers = (
    axiosModule.default.interceptors.request as unknown as {
      handlers: { fulfilled?: (config: unknown) => unknown }[];
    }
  ).handlers;
  const before = handlers.length;

  await import('../src/utils/httpClient.js');

  const fulfilled = handlers[before]?.fulfilled;
  if (!fulfilled) throw new Error('request interceptor was not registered');

  const apiOrigin = await import('../src/utils/apiOrigin.js');

  return {
    // 기본 대상은 등록된 API 오리진이다. url을 넘기면 그 오리진으로 나가는 요청을 흉내낸다.
    run: async (url = `${API_URL}/api/projects/p/plans`): Promise<Record<string, unknown>> => {
      const headers: Record<string, unknown> = {};
      await fulfilled({ headers, url });
      return headers;
    },
    registerApiOrigin: apiOrigin.registerApiOrigin,
  };
};

describe('CLI session identity headers', () => {
  it('sends machineId and the project root hash when both resolve', async () => {
    const { run } = await loadInterceptor({ machineId: 'machine-1', projectRootHash: 'abc123' });

    expect(await run()).toMatchObject({
      'X-AgentTeams-Machine-Id': 'machine-1',
      'X-AgentTeams-Project-Root-Hash': 'abc123',
    });
  });

  // 빈 문자열을 실으면 서버가 "값이 있다"고 읽고 아무 후보와도 맞지 않는 조회를 돈다.
  // 값이 없으면 헤더 자체를 빼야 "좁히지 못함"으로 판정된다.
  it('omits the header instead of sending an empty value when machineId is unavailable', async () => {
    const { run } = await loadInterceptor({ machineId: null, projectRootHash: 'abc123' });
    const headers = await run();

    expect(headers).not.toHaveProperty('X-AgentTeams-Machine-Id');
    expect(headers['X-AgentTeams-Project-Root-Hash']).toBe('abc123');
  });

  it('omits the project root hash header when there is no project config', async () => {
    const { run } = await loadInterceptor({ machineId: 'machine-1', projectRootHash: null });
    const headers = await run();

    expect(headers['X-AgentTeams-Machine-Id']).toBe('machine-1');
    expect(headers).not.toHaveProperty('X-AgentTeams-Project-Root-Hash');
  });

  // 프리사인 업로드는 AgentTeams API가 아니라 오브젝트 스토리지로 직접 나간다. 영구 디바이스 UUID와
  // 작업 디렉터리 지문이 그 요청 로그에 남으면 첨부 업로드만으로 디바이스 상관관계 추적이 가능해진다.
  it('omits the identity headers for a presigned upload to object storage', async () => {
    const { run } = await loadInterceptor({ machineId: 'machine-1', projectRootHash: 'abc123' });
    const headers = await run('https://bucket.r2.cloudflarestorage.com/uploads/abc?X-Amz-Signature=deadbeef');

    expect(headers).not.toHaveProperty('X-AgentTeams-Machine-Id');
    expect(headers).not.toHaveProperty('X-AgentTeams-Project-Root-Hash');
  });

  // 커스텀 배포는 기본 오리진과 다르다. resolveApiContext()가 등록한 오리진이면 도구 축이 살아 있어야 한다.
  it('sends the identity headers to a registered custom API origin', async () => {
    const { run, registerApiOrigin } = await loadInterceptor({ machineId: 'machine-1', projectRootHash: 'abc123' });
    registerApiOrigin('https://api.example.internal/');

    expect(await run('https://api.example.internal/api/projects/p/plans')).toMatchObject({
      'X-AgentTeams-Machine-Id': 'machine-1',
      'X-AgentTeams-Project-Root-Hash': 'abc123',
    });
  });
});
