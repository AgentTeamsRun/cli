import { createRequire } from 'node:module';
import axios from 'axios';
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getActiveCredential } from '../auth/activeCredential.js';
import { getCommandContext } from './commandContext.js';
import { writeCache } from './updateCheck.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
  /** Set once per request. A second 401 is a real authentication failure, not a stale token. */
  _authRefreshAttempted?: boolean;
}

/**
 * Only a request that authenticated with a bearer token can be fixed by a
 * refresh. An `X-API-Key` request carries a long-lived agent key with nothing
 * behind it, so a 401 there means the key itself is wrong.
 */
function usedBearerCredential(config: InternalAxiosRequestConfig): boolean {
  const headers = config.headers as unknown as {
    get?: (name: string) => unknown;
    Authorization?: unknown;
    'X-API-Key'?: unknown;
  };

  const read = (name: string): unknown =>
    typeof headers?.get === 'function' ? headers.get(name) : (headers as Record<string, unknown>)?.[name];

  return typeof read('Authorization') === 'string' && read('X-API-Key') === undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelay = (error: AxiosError, attempt: number): number => {
  const retryAfterHeader = error.response?.headers?.['retry-after'];
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1_000;
    }
  }

  const body = error.response?.data as { retryAfter?: number } | undefined;
  if (body?.retryAfter && body.retryAfter > 0) {
    return body.retryAfter * 1_000;
  }

  return BASE_DELAY_MS * 2 ** attempt;
};

axios.defaults.headers.common['X-CLI-Version'] = pkg.version;

const setRequestHeader = (config: InternalAxiosRequestConfig, name: string, value: string): void => {
  const headers = config.headers;
  if (typeof headers.set === 'function') {
    headers.set(name, value);
    return;
  }

  (headers as unknown as Record<string, string>)[name] = value;
};

axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  setRequestHeader(config, 'X-AgentTeams-Client', 'cli');
  setRequestHeader(config, 'X-AgentTeams-Command', getCommandContext());
  setRequestHeader(config, 'X-AgentTeams-Version', pkg.version);
  return config;
});

axios.interceptors.response.use(
  (response: AxiosResponse) => {
    const latestVersion = response.headers['x-cli-latest-version'] as string | undefined;
    if (latestVersion) {
      writeCache({ lastCheck: Date.now(), latestVersion });
    }
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;

    // A personal access token lives 15 minutes, so a long command can outlive
    // the one it started with. Refresh once and replay; anything beyond that is
    // a genuine authentication failure and must reach the user.
    if (config && error.response?.status === 401 && !config._authRefreshAttempted && usedBearerCredential(config)) {
      const credential = getActiveCredential();
      if (credential) {
        config._authRefreshAttempted = true;
        const accessToken = await credential.refresh();
        if (accessToken) {
          setRequestHeader(config, 'Authorization', `Bearer ${accessToken}`);
          return axios.request(config);
        }
      }
    }

    if (!config || error.response?.status !== 429) {
      throw error;
    }

    const retryCount = config._retryCount ?? 0;

    if (retryCount >= MAX_RETRIES) {
      throw error;
    }

    config._retryCount = retryCount + 1;
    const delay = getRetryDelay(error, retryCount);

    await sleep(delay);
    return axios.request(config);
  },
);

export default axios;
