import { createRequire } from 'node:module';
import axios from 'axios';
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { writeCache } from './updateCheck.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
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
