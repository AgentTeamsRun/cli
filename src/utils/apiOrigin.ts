/**
 * Which origins may receive AgentTeams session identity headers.
 *
 * The CLI talks to more than one host. Entity writes go to the AgentTeams API, but attachment
 * uploads go straight to a presigned object-storage URL (`commands/attachment.ts`), and a global
 * axios interceptor cannot tell the two apart on its own. Sending the session identity headers
 * everywhere would hand a stable device UUID and a fingerprint of the user's working directory to
 * a storage endpoint that has no use for them — it ignores unsigned headers, so the leak would
 * never surface as a failure. `desktop/src/main/webview/client-header.ts` scopes the same class of
 * header by origin for the same reason.
 *
 * This module must not import the config loader: `utils/httpClient.ts` consumes it, and the loader
 * imports the token client, which imports the HTTP layer back (see `auth/activeCredential.ts`).
 * So origins arrive two ways instead:
 *
 * - **Seeded** from the environment and the built-in default, covering paths that run before a
 *   project config is resolved (`init`, `auth login`).
 * - **Registered** by `resolveApiContext()`, the single place every command and the MCP server
 *   resolve their API base URL — including a `--api-url` override that no seed could predict.
 *
 * Unknown origin means the headers are omitted. Fail-closed: a missed origin costs the tool axis
 * on that request, while a wrong one leaks the identifiers for good.
 */

/** Mirrors `utils/config.ts` DEFAULT_API_URL. Duplicated to keep the import cycle above from existing. */
const DEFAULT_API_ORIGIN_URL = 'https://api.agentteams.run';

const knownApiOrigins = new Set<string>();

const toOrigin = (rawUrl: string | null | undefined): string | null => {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
};

/** Record an API base URL the CLI resolved for itself. Called from `resolveApiContext()`. */
export const registerApiOrigin = (rawUrl: string | null | undefined): void => {
  const origin = toOrigin(rawUrl);
  if (origin) knownApiOrigins.add(origin);
};

registerApiOrigin(DEFAULT_API_ORIGIN_URL);
registerApiOrigin(process.env.AGENTTEAMS_API_URL);

/**
 * Resolve the absolute origin an axios request will actually reach.
 *
 * `baseURL` is the base only when the url is relative; an absolute url wins, which is exactly the
 * presigned-upload shape (`axios.put(uploadUrl, ...)` with no baseURL at all).
 */
export const resolveRequestOrigin = (request: { url?: string; baseURL?: string }): string | null => {
  const { url, baseURL } = request;
  if (!url && !baseURL) return null;

  const direct = toOrigin(url);
  if (direct) return direct;

  if (!baseURL) return null;
  try {
    return new URL(url ?? '', baseURL).origin;
  } catch {
    return null;
  }
};

/** True only for a request headed to an AgentTeams API origin this process resolved for itself. */
export const isApiOriginRequest = (request: { url?: string; baseURL?: string }): boolean => {
  const origin = resolveRequestOrigin(request);
  return origin !== null && knownApiOrigins.has(origin);
};

/** Test seam. The registry is process-wide and memoized by design. */
export const __resetApiOriginsForTest = (): void => {
  knownApiOrigins.clear();
  registerApiOrigin(DEFAULT_API_ORIGIN_URL);
  registerApiOrigin(process.env.AGENTTEAMS_API_URL);
};
