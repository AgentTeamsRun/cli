import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

type RetryConfig = InternalAxiosRequestConfig & {
  _retryCount?: number;
  _authRefreshAttempted?: boolean;
};

describe('httpClient 401 → refresh retry', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function loadModule() {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return null;
    }

    const responseHandlers: Array<{ onRejected: (error: AxiosError) => Promise<unknown> }> = [];

    const axiosMock = {
      defaults: { headers: { common: {} as Record<string, string> } },
      interceptors: {
        request: { use: jest.fn(() => 0) },
        response: {
          use: jest.fn((_onFulfilled: unknown, onRejected: unknown) => {
            responseHandlers.push({ onRejected: onRejected as (error: AxiosError) => Promise<unknown> });
            return 0;
          }),
        },
      },
      request: jest.fn<() => Promise<unknown>>(),
    };

    (jest as any).unstable_mockModule('axios', () => ({ default: axiosMock }));
    (jest as any).unstable_mockModule('../src/utils/updateCheck.js', () => ({ writeCache: jest.fn() }));

    await import('../src/utils/httpClient.js');

    return {
      axiosMock,
      onRejected: responseHandlers[0]?.onRejected,
      activeCredential: await import('../src/auth/activeCredential.js'),
    };
  }

  function makeError(status: number, config: RetryConfig): AxiosError {
    return {
      isAxiosError: true,
      name: 'AxiosError',
      message: `HTTP ${status}`,
      config,
      toJSON: () => ({}),
      response: { status, statusText: 'error', headers: {}, config, data: {} },
    } as AxiosError;
  }

  const bearerConfig = (token = 'atp_stale'): RetryConfig =>
    ({ headers: { Authorization: `Bearer ${token}` } }) as unknown as RetryConfig;

  it('refreshes once and replays the request with the new token', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    const refresh = jest.fn(async () => 'atp_fresh');
    loaded.activeCredential.setActiveCredential({ refresh });
    loaded.axiosMock.request.mockResolvedValue({ data: { ok: true } });

    const config = bearerConfig();
    const result = await loaded.onRejected?.(makeError(401, config));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true } });
    const replayed = (loaded.axiosMock.request.mock.calls as unknown as RetryConfig[][])[0]?.[0] as RetryConfig;
    expect((replayed.headers as unknown as Record<string, string>).Authorization).toBe('Bearer atp_fresh');
    expect(replayed._authRefreshAttempted).toBe(true);
  });

  it('replays an expired Desktop-injected token with the matching CLI login', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    const previousMemberId = process.env.AGENTTEAMS_MCP_MEMBER_ID;
    process.env.AGENTTEAMS_MCP_MEMBER_ID = 'member-1';
    const getAccessToken = jest
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('atp_cli_initial')
      .mockResolvedValueOnce('atp_cli_refreshed');
    const client = {
      hasCredential: () => true,
      getAccessToken,
      invalidateAccessToken: jest.fn(),
      state: () => ({ identity: { memberId: 'member-1' } }),
    };

    try {
      const { resolveCredential } = await import('../src/utils/config.js');
      await resolveCredential(
        {
          apiKey: 'atp_desktop_expired',
          apiUrl: 'https://api.agentteams.run',
          teamId: 'team-1',
          projectId: 'project-1',
        },
        { getClient: () => client as never },
      );
      loaded.axiosMock.request.mockResolvedValue({ data: { ok: true } });

      const result = await loaded.onRejected?.(makeError(401, bearerConfig('atp_desktop_expired')));

      expect(result).toEqual({ data: { ok: true } });
      expect(getAccessToken).toHaveBeenCalledTimes(2);
      const replayed = (loaded.axiosMock.request.mock.calls as unknown as RetryConfig[][])[0]?.[0] as RetryConfig;
      expect((replayed.headers as unknown as Record<string, string>).Authorization).toBe('Bearer atp_cli_refreshed');
    } finally {
      if (previousMemberId === undefined) delete process.env.AGENTTEAMS_MCP_MEMBER_ID;
      else process.env.AGENTTEAMS_MCP_MEMBER_ID = previousMemberId;
    }
  });

  it('does not retry a second time when the replayed request is also 401', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    const refresh = jest.fn(async () => 'atp_fresh');
    loaded.activeCredential.setActiveCredential({ refresh });

    const config = { ...bearerConfig(), _authRefreshAttempted: true } as RetryConfig;
    await expect(loaded.onRejected?.(makeError(401, config))).rejects.toBeDefined();

    expect(refresh).not.toHaveBeenCalled();
    expect(loaded.axiosMock.request).not.toHaveBeenCalled();
  });

  it('surfaces the original failure when the refresh cannot produce a token', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    loaded.activeCredential.setActiveCredential({ refresh: jest.fn(async () => null) });

    await expect(loaded.onRejected?.(makeError(401, bearerConfig()))).rejects.toBeDefined();
    expect(loaded.axiosMock.request).not.toHaveBeenCalled();
  });

  it('never attempts a refresh on the legacy X-API-Key path', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    const refresh = jest.fn(async () => 'atp_fresh');
    loaded.activeCredential.setActiveCredential({ refresh });

    const config = { headers: { 'X-API-Key': 'key_legacy' } } as unknown as RetryConfig;
    await expect(loaded.onRejected?.(makeError(401, config))).rejects.toBeDefined();

    expect(refresh).not.toHaveBeenCalled();
    expect(loaded.axiosMock.request).not.toHaveBeenCalled();
  });

  it('never attempts a refresh when no refreshable credential is registered', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    loaded.activeCredential.resetActiveCredentialForTests();

    await expect(loaded.onRejected?.(makeError(401, bearerConfig()))).rejects.toBeDefined();
    expect(loaded.axiosMock.request).not.toHaveBeenCalled();
  });

  it('leaves the 429 backoff path untouched', async () => {
    const loaded = await loadModule();
    if (!loaded) return;

    const refresh = jest.fn(async () => 'atp_fresh');
    loaded.activeCredential.setActiveCredential({ refresh });
    loaded.axiosMock.request.mockResolvedValue({ data: { ok: true } });
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    });

    const result = await loaded.onRejected?.(makeError(429, bearerConfig()));

    expect(refresh).not.toHaveBeenCalled();
    expect(loaded.axiosMock.request).toHaveBeenCalledWith(expect.objectContaining({ _retryCount: 1 }));
    expect(result).toEqual({ data: { ok: true } });
  });
});
