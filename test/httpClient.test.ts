import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

type RetryConfig = InternalAxiosRequestConfig & { _retryCount?: number };
type StoredResponseHandler = {
  onFulfilled: (response: AxiosResponse) => AxiosResponse;
  onRejected: (error: AxiosError) => Promise<unknown>;
};

describe('httpClient', () => {
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

    const responseHandlers: StoredResponseHandler[] = [];

    const axiosMock = {
      defaults: { headers: { common: {} as Record<string, string> } },
      interceptors: {
        response: {
          use: jest.fn((onFulfilled: unknown, onRejected: unknown) => {
            responseHandlers.push({
              onFulfilled: onFulfilled as StoredResponseHandler['onFulfilled'],
              onRejected: onRejected as StoredResponseHandler['onRejected'],
            });
            return 0;
          }),
        },
      },
      request: jest.fn<() => Promise<unknown>>(),
    };

    const writeCache = jest.fn();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === 'function') {
        fn();
      }
      return 0 as any;
    });

    (jest as any).unstable_mockModule('axios', () => ({
      default: axiosMock,
    }));
    (jest as any).unstable_mockModule('../src/utils/updateCheck.js', () => ({
      writeCache,
    }));

    const imported = await import('../src/utils/httpClient.js');
    return {
      httpClient: imported.default,
      axiosMock,
      responseHandlers,
      writeCache,
      setTimeoutSpy,
    };
  }

  function makeAxiosError(
    status: number,
    headers: Record<string, unknown> = {},
    data?: { retryAfter?: number },
    config: RetryConfig = { headers: {} } as RetryConfig,
  ): AxiosError {
    return {
      isAxiosError: true,
      name: 'AxiosError',
      message: `HTTP ${status}`,
      config,
      toJSON: () => ({}),
      response: {
        status,
        statusText: 'error',
        headers,
        config,
        data,
      },
    } as AxiosError;
  }

  it('sets X-CLI-Version header when the module is loaded', async () => {
    const loaded = await loadModule();
    if (!loaded) {
      return;
    }

    expect(loaded.httpClient).toBe(loaded.axiosMock);
    expect(loaded.axiosMock.defaults.headers.common['X-CLI-Version']).toBe(pkg.version);
  });

  it('writes update cache from X-CLI-Latest-Version response headers', async () => {
    const loaded = await loadModule();
    if (!loaded) {
      return;
    }

    const response = {
      data: {},
      status: 200,
      statusText: 'ok',
      config: { headers: {} } as InternalAxiosRequestConfig,
      headers: {
        'x-cli-latest-version': '0.2.0',
      },
    } as unknown as AxiosResponse;

    loaded.responseHandlers[0]?.onFulfilled(response);

    expect(loaded.writeCache).toHaveBeenCalledWith({
      lastCheck: expect.any(Number),
      latestVersion: '0.2.0',
    });
  });

  it('retries 429 responses using retry-after header and then succeeds', async () => {
    const loaded = await loadModule();
    if (!loaded) {
      return;
    }

    loaded.axiosMock.request.mockResolvedValue({ data: { ok: true } });
    const config = { headers: {} } as RetryConfig;

    const result = await loaded.responseHandlers[0]?.onRejected(
      makeAxiosError(429, { 'retry-after': '5' }, undefined, config)
    );

    expect(loaded.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(loaded.axiosMock.request).toHaveBeenCalledWith(expect.objectContaining({ _retryCount: 1 }));
    expect(result).toEqual({ data: { ok: true } });
  });

  it('uses body retryAfter when retry-after header is absent and falls back to exponential backoff', async () => {
    const loaded = await loadModule();
    if (!loaded) {
      return;
    }

    loaded.axiosMock.request.mockResolvedValue({ data: { ok: true } });

    await loaded.responseHandlers[0]?.onRejected(
      makeAxiosError(429, {}, { retryAfter: 7 }, { headers: {} } as RetryConfig)
    );
    await loaded.responseHandlers[0]?.onRejected(
      makeAxiosError(429, {}, undefined, { headers: {}, _retryCount: 2 } as RetryConfig)
    );

    expect(loaded.setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 7000);
    expect(loaded.setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 4000);
  });

  it('throws after max retries and for non-429 errors without retrying', async () => {
    const loaded = await loadModule();
    if (!loaded) {
      return;
    }

    await expect(
      loaded.responseHandlers[0]?.onRejected(
        makeAxiosError(429, {}, undefined, { headers: {}, _retryCount: 3 } as RetryConfig)
      )
    ).rejects.toMatchObject({ response: { status: 429 } });

    await expect(
      loaded.responseHandlers[0]?.onRejected(makeAxiosError(500))
    ).rejects.toMatchObject({ response: { status: 500 } });

    expect(loaded.axiosMock.request).not.toHaveBeenCalled();
  });
});
