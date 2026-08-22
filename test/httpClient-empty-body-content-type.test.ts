import { describe, expect, it, jest } from '@jest/globals';

/** The built-in default origin, seeded by `utils/apiOrigin.ts` without any config lookup. */
const API_URL = 'https://api.agentteams.run';

type RequestConfig = {
  method: string;
  data?: unknown;
};

/**
 * `resolveApiContext()` always sets `Content-Type: application/json`. Fastify then rejects a
 * body-less request that still declares JSON (`FST_ERR_CTP_EMPTY_JSON_BODY`) before the route
 * runs, and `errors.ts` wraps the 400 as "Bad request (validation)". The interceptor must drop
 * the header when `data` is missing — this harness feeds a plain header object the way CLI
 * callers do, not AxiosHeaders.
 */
const loadInterceptor = async () => {
  jest.resetModules();

  jest.unstable_mockModule('../src/utils/machineId.js', () => ({
    readOrCreateMachineId: () => 'machine-1',
    getMachineIdPath: () => '/tmp/machine-id',
  }));
  jest.unstable_mockModule('../src/utils/projectRootHash.js', () => ({
    resolveProjectRootHash: () => 'abc123',
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

  return async (request: RequestConfig): Promise<Record<string, unknown>> => {
    const headers: Record<string, unknown> = { 'Content-Type': 'application/json' };
    await fulfilled({
      headers,
      url: `${API_URL}/api/projects/p/skills/skill-1`,
      method: request.method,
      data: request.data,
    });
    return headers;
  };
};

describe('CLI empty-body Content-Type stripping', () => {
  it('omits Content-Type on a body-less delete', async () => {
    const run = await loadInterceptor();
    const headers = await run({ method: 'delete' });

    expect(headers).not.toHaveProperty('Content-Type');
  });

  it('omits Content-Type on a body-less get', async () => {
    const run = await loadInterceptor();
    const headers = await run({ method: 'get' });

    expect(headers).not.toHaveProperty('Content-Type');
  });

  it('keeps Content-Type on a delete that has a body', async () => {
    const run = await loadInterceptor();
    const headers = await run({ method: 'delete', data: { reason: 'cleanup' } });

    expect(headers['Content-Type']).toBe('application/json');
  });

  it('keeps Content-Type on a post that has a body', async () => {
    const run = await loadInterceptor();
    const headers = await run({ method: 'post', data: { name: 'skill' } });

    expect(headers['Content-Type']).toBe('application/json');
  });
});
