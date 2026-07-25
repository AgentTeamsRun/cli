import type { Config } from '../types/index.js';

const CONFIG_OVERRIDE_KEYS = ['apiKey', 'apiUrl', 'teamId', 'projectId'] as const;

/**
 * Collect config overrides passed as CLI options.
 *
 * Shared with long-running entry points (e.g. `mcp`) that never reach
 * `executeCommand()` but must honour the same override contract.
 */
export function buildConfigOverrides(options: Record<string, unknown>): Partial<Config> {
  const overrides: Record<string, string> = {};
  for (const key of CONFIG_OVERRIDE_KEYS) {
    const value = options[key];
    if (typeof value === 'string' && value.length > 0) {
      overrides[key] = value;
    }
  }
  return overrides;
}

export function resolveApiContext(config: Config): { apiUrl: string; headers: Record<string, string> } {
  const apiUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;
  const headers = {
    'X-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  };
  return { apiUrl, headers };
}
