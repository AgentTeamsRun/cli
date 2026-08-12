import type { Config } from '../types/index.js';
import { registerApiOrigin } from './apiOrigin.js';

const CONFIG_OVERRIDE_KEYS = ['apiKey', 'apiUrl', 'projectId'] as const;

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

/** Agent API keys are the only credential the server accepts on `X-API-Key`. */
const AGENT_API_KEY_PREFIX = 'key_';

/**
 * Pick the header that matches the credential kind.
 *
 * The server gates `X-API-Key` on the `key_` prefix and rejects anything else
 * before it looks the credential up, so a desktop personal access token
 * (`atp_`) sent that way always fails as "Invalid API key". Personal tokens —
 * and any other bearer credential — authenticate through `Authorization`.
 */
export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey.startsWith(AGENT_API_KEY_PREFIX) ? { 'X-API-Key': apiKey } : { Authorization: `Bearer ${apiKey}` };
}

export function resolveApiContext(config: Config): { apiUrl: string; headers: Record<string, string> } {
  const apiUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;
  // This is where the CLI settles on "the API" for this invocation — env, config file, or an
  // --api-url override alike. The HTTP layer scopes session identity headers to what lands here,
  // so a custom deployment keeps the tool axis without leaking it to presigned upload hosts.
  registerApiOrigin(apiUrl);
  const headers = {
    ...buildAuthHeaders(config.apiKey),
    'Content-Type': 'application/json',
  };
  return { apiUrl, headers };
}
