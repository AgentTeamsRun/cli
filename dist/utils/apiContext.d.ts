import type { Config } from '../types/index.js';
/**
 * Collect config overrides passed as CLI options.
 *
 * Shared with long-running entry points (e.g. `mcp`) that never reach
 * `executeCommand()` but must honour the same override contract.
 */
export declare function buildConfigOverrides(options: Record<string, unknown>): Partial<Config>;
/**
 * Pick the header that matches the credential kind.
 *
 * The server gates `X-API-Key` on the `key_` prefix and rejects anything else
 * before it looks the credential up, so a desktop personal access token
 * (`atp_`) sent that way always fails as "Invalid API key". Personal tokens —
 * and any other bearer credential — authenticate through `Authorization`.
 */
export declare function buildAuthHeaders(apiKey: string): Record<string, string>;
export declare function resolveApiContext(config: Config): {
    apiUrl: string;
    headers: Record<string, string>;
};
//# sourceMappingURL=apiContext.d.ts.map