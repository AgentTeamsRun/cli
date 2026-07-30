/**
 * Personal opaque-token client for the CLI.
 *
 * Ported from `desktop/src/main/localAgent/personalTokenClient.ts`, which drives
 * the same server endpoints (`/api/auth/desktop/{authorize,token,revoke}`). The
 * two clients must keep the same three guarantees, because each one exists to
 * stop a specific failure that has bitten this flow before:
 *
 *  1. Refresh ahead of expiry (60s skew) so a request never races the clock.
 *  2. Collapse concurrent refreshes into one in-flight promise, so five
 *     parallel calls rotate the refresh token once rather than five times.
 *  3. Delete the stored refresh token **only** on an explicit `invalid_grant`.
 *     A flaky network must not log the user out — otherwise one offline moment
 *     costs a full re-login even after connectivity returns.
 *
 * Guarantee 2 covers one process. Rotation also has to be serialized *across*
 * processes, because a one-shot `agentteams` command and a long-lived
 * `agentteams mcp` share one credential slot: see {@link RefreshLock}.
 */

import type { CredentialBackendId, CredentialSaveOutcome, CredentialStoreReason } from './credentialStore.js';
import { createPersonalTokenStore, personalTokenSlot, type PersonalTokenStore } from './personalTokenStore.js';
import {
  createFileRefreshLock,
  noopRefreshLock,
  DEFAULT_STALE_AFTER_MS,
  RefreshLockTimeoutError,
  RefreshLockUnavailableError,
  type RefreshLock,
} from './refreshLock.js';

/** Registered in `api/src/services/personalTokenClients.ts`; the server rejects anything else. */
export const CLI_OAUTH_CLIENT_ID = 'agentteams-cli';

/** Refresh this far before the server-declared expiry rather than at it. */
export const ACCESS_REFRESH_SKEW_MS = 60_000;

/**
 * Cap on a token-endpoint request.
 *
 * Deliberately below {@link DEFAULT_STALE_AFTER_MS}: a rotation runs with the
 * cross-process lock held, and if it could outlast the staleness window another
 * process would judge the lock abandoned, take it, and rotate the same refresh
 * token — the reuse that revokes the whole family. Bounding the request keeps the
 * holder inside the window it promised.
 */
export const TOKEN_REQUEST_TIMEOUT_MS = Math.floor(DEFAULT_STALE_AFTER_MS / 2);

export type PersonalTokenErrorCode =
  | 'INVALID_GRANT'
  | 'TRANSIENT'
  | 'NOT_LOGGED_IN'
  | 'MALFORMED_RESPONSE'
  | 'REVOKE_FAILED'
  /** A fresh login succeeded but the credential could not be kept anywhere durable. */
  | 'STORE_UNAVAILABLE';

export class PersonalTokenError extends Error {
  constructor(
    readonly code: PersonalTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PersonalTokenError';
  }
}

export interface PersonalTokenIdentity {
  memberId: string;
  email: string;
  nickname: string;
}

export interface PersonalTokenSession {
  accessToken: string;
  /** Epoch milliseconds, derived from the server's `expiresIn`. */
  expiresAt: number;
  identity: PersonalTokenIdentity;
}

/**
 * Why the last refresh attempt produced no token. `null` once one succeeds.
 *
 * Exists so the caller can name the actual problem: every one of these used to
 * surface as "check your network connection", which sends the user after a
 * network that is fine.
 */
export type PersonalTokenRefreshFailure = 'NETWORK' | 'LOCK_CONTENTION' | 'LOCK_UNAVAILABLE';

export interface PersonalTokenState {
  /** A refresh token exists locally. It may still turn out to be revoked. */
  connected: boolean;
  /** false → the refresh token is session-memory only and disappears with this process. */
  persisted: boolean;
  /** Which OS store is in play, regardless of whether it currently works. */
  storeBackend: CredentialBackendId;
  storeReason: CredentialStoreReason;
  identity: PersonalTokenIdentity | null;
  expiresAt: number | null;
  /** The server rejected the refresh token; only a fresh login recovers. */
  reconnectRequired: boolean;
  /** Why the last refresh produced nothing; null when it succeeded or never ran. */
  refreshFailure: PersonalTokenRefreshFailure | null;
}

export interface AuthorizationCodeGrant {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface PersonalTokenClientDeps {
  apiUrl: string;
  store: PersonalTokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * Serializes rotation against other processes. Defaults to a pass-through so
   * a client built in a test touches no filesystem; {@link getPersonalTokenClient}
   * supplies the real file lock for every shipped code path.
   */
  lock?: RefreshLock;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  identity: PersonalTokenIdentity;
}

type ParsedTokenResponse =
  | { kind: 'success'; tokens: TokenResponse }
  | { kind: 'invalidGrant' }
  | { kind: 'transient'; detail: string };

/**
 * Classify a token-endpoint response.
 *
 * The split that matters is `invalid_grant` (the server has definitively
 * refused this refresh token) versus everything else (5xx, a proxy error page,
 * a truncated body). Only the first justifies destroying local credentials.
 */
export async function parseTokenResponse(response: Response): Promise<ParsedTokenResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'transient', detail: `HTTP ${response.status} with an unreadable body` };
  }

  const error = body && typeof body === 'object' && 'error' in body ? (body as { error?: unknown }).error : undefined;

  if (!response.ok) {
    if ((response.status === 400 || response.status === 401) && error === 'invalid_grant') {
      return { kind: 'invalidGrant' };
    }
    return { kind: 'transient', detail: `HTTP ${response.status}` };
  }

  const data =
    body && typeof body === 'object' && 'data' in body ? (body as { data?: Record<string, unknown> }).data : undefined;
  const identity =
    data?.identity && typeof data.identity === 'object' ? (data.identity as Record<string, unknown>) : undefined;

  if (
    typeof data?.accessToken !== 'string' ||
    typeof data.refreshToken !== 'string' ||
    typeof data.expiresIn !== 'number' ||
    !identity ||
    typeof identity.memberId !== 'string' ||
    typeof identity.email !== 'string' ||
    typeof identity.nickname !== 'string'
  ) {
    return { kind: 'transient', detail: 'the server returned an unexpected token payload' };
  }

  return {
    kind: 'success',
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      identity: {
        memberId: identity.memberId,
        email: identity.email,
        nickname: identity.nickname,
      },
    },
  };
}

export class PersonalTokenClient {
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private identity: PersonalTokenIdentity | null = null;
  private reconnectRequired = false;
  private refreshFailure: PersonalTokenRefreshFailure | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly deps: PersonalTokenClientDeps) {}

  state(): PersonalTokenState {
    const storeStatus = this.deps.store.status();
    return {
      connected: this.deps.store.read() !== null,
      persisted: storeStatus.persisted,
      storeBackend: storeStatus.backend,
      storeReason: storeStatus.reason,
      identity: this.identity,
      expiresAt: this.accessToken ? this.accessExpiresAt : null,
      reconnectRequired: this.reconnectRequired,
      refreshFailure: this.refreshFailure,
    };
  }

  hasCredential(): boolean {
    return this.deps.store.read() !== null;
  }

  /**
   * Trade a PKCE authorization code for the first token pair.
   *
   * A failure here leaves nothing behind: there is no prior credential to
   * protect, and a half-finished login must not look like a connected one.
   * That includes the case where the store refuses to keep the credential — a
   * fresh login the next command cannot see is not a login, and the refresh
   * token the server just minted would outlive this process with nobody able to
   * use or cancel it. It is revoked rather than left orphaned.
   */
  async exchangeAuthorizationCode(grant: AuthorizationCodeGrant): Promise<PersonalTokenSession> {
    let parsed: ParsedTokenResponse;
    try {
      parsed = await this.postToken({
        grantType: 'authorization_code',
        clientId: CLI_OAUTH_CLIENT_ID,
        code: grant.code,
        codeVerifier: grant.codeVerifier,
        redirectUri: grant.redirectUri,
      });
    } catch (error) {
      throw new PersonalTokenError(
        'TRANSIENT',
        `Could not reach the server to exchange the authorization code: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }

    if (parsed.kind === 'invalidGrant') {
      throw new PersonalTokenError(
        'INVALID_GRANT',
        'The authorization code was rejected. It may have expired or already been used — run `agentteams auth login` again.',
      );
    }
    if (parsed.kind !== 'success') {
      throw new PersonalTokenError('TRANSIENT', `Token exchange failed: ${parsed.detail}.`);
    }

    const stored = this.acceptTokens(parsed.tokens);
    this.reconnectRequired = false;

    if (!stored.persisted) {
      await this.discardUnstorableTokens(stored);
    }

    return {
      accessToken: parsed.tokens.accessToken,
      expiresAt: this.accessExpiresAt,
      identity: parsed.tokens.identity,
    };
  }

  /**
   * Undo a login whose credential could not be stored.
   *
   * Revoking is best-effort — an unreachable server is not a reason to keep a
   * dangling local state — but the local copy always goes, so `hasCredential()`
   * never reports a login the next process will not find.
   */
  private async discardUnstorableTokens(outcome: CredentialSaveOutcome): Promise<never> {
    let serverRevoked = true;
    try {
      await this.revoke();
    } catch {
      serverRevoked = false;
      this.clear();
    }

    const cause =
      outcome.reason === 'WRITE_FAILED'
        ? `the OS credential store rejected the write${outcome.detail ? ` (${outcome.detail})` : ''}`
        : 'this machine has no usable OS credential store';

    throw new PersonalTokenError(
      'STORE_UNAVAILABLE',
      `Signed in, but the login could not be saved: ${cause}. ` +
        (serverRevoked
          ? 'The issued token was revoked so nothing is left behind. '
          : 'The token could not be revoked either — cancel it from the AgentTeams web app. ') +
        'On CI, containers and headless machines use an API key (AGENTTEAMS_API_KEY) instead.',
    );
  }

  /**
   * Current access token, refreshing pre-emptively when it is close to expiry.
   * Returns null when there is nothing usable — the caller decides whether that
   * is a hard failure or a reason to fall back to another credential.
   */
  async getAccessToken(): Promise<string | null> {
    const now = this.now();
    if (this.accessToken && this.accessExpiresAt - ACCESS_REFRESH_SKEW_MS > now) {
      return this.accessToken;
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  /** Force the next {@link getAccessToken} to refresh even if the cached token looks fresh. */
  invalidateAccessToken(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
  }

  /**
   * Revoke the token family server-side, then drop the local copy.
   *
   * The order is not negotiable: clearing first and failing the revoke would
   * leave a live refresh token on the server that the user can no longer see or
   * cancel.
   */
  async revoke(): Promise<void> {
    // Fresh: a logout has to revoke the token the family is actually on, not a
    // copy this process cached before someone else rotated it.
    //
    // Falling back to the cached copy is safe and necessary here: revocation
    // kills the whole family, so a superseded token from the same family does the
    // same job, and a read that failed (locked keychain, denied prompt) must not
    // make logout claim there is nothing to revoke while a live token sits in the
    // store — that would leave it valid server-side with no way to reach it.
    const refreshToken = this.deps.store.read({ fresh: true }) ?? this.deps.store.read();
    if (!refreshToken) {
      throw new PersonalTokenError('NOT_LOGGED_IN', 'No personal token is stored for this server.');
    }

    const doFetch = this.deps.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(`${this.baseUrl()}/api/auth/desktop/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLI_OAUTH_CLIENT_ID, token: refreshToken }),
      });
    } catch (error) {
      throw new PersonalTokenError(
        'REVOKE_FAILED',
        `Could not reach the server to revoke the token: ${error instanceof Error ? error.message : String(error)}. The local credential was kept.`,
      );
    }

    if (!response.ok) {
      throw new PersonalTokenError(
        'REVOKE_FAILED',
        `The server refused to revoke the token (HTTP ${response.status}). The local credential was kept.`,
      );
    }

    this.clear();
  }

  /**
   * Drop the local credential without asking the server.
   *
   * The offline escape hatch behind `auth logout --local`: the token stays valid
   * server-side, so the caller owes the user a "revoke it in the web app" note.
   */
  forgetLocalCredential(): void {
    this.clear();
  }

  private async refresh(): Promise<string | null> {
    // Cheap pre-check off the cache: no credential means there is nothing to
    // serialize against, so the lock is never taken for a logged-out process.
    if (!this.deps.store.read()) return null;

    try {
      const accessToken = await (this.deps.lock ?? noopRefreshLock).withLock(() => this.rotate());
      if (accessToken) this.refreshFailure = null;
      return accessToken;
    } catch (error) {
      // Both lock problems leave the refresh token exactly where it is, so the
      // next command retries. Rotating anyway would risk the server's reuse
      // detection revoking the whole family, which costs a full re-login. They
      // are recorded distinctly so the caller does not blame the network.
      if (error instanceof RefreshLockTimeoutError) {
        this.refreshFailure = 'LOCK_CONTENTION';
        return null;
      }
      if (error instanceof RefreshLockUnavailableError) {
        this.refreshFailure = 'LOCK_UNAVAILABLE';
        return null;
      }
      throw error;
    }
  }

  /** The rotation itself. Runs with the cross-process lock held. */
  private async rotate(): Promise<string | null> {
    // Re-read past the store's process-lifetime cache. Another process may have
    // rotated — or cleared — the family while this one waited for the lock, and
    // presenting the superseded token is precisely what makes the server revoke
    // every token in the family.
    const refreshToken = this.deps.store.read({ fresh: true });
    if (!refreshToken) return null;

    let parsed: ParsedTokenResponse;
    try {
      parsed = await this.postToken({
        grantType: 'refresh_token',
        clientId: CLI_OAUTH_CLIENT_ID,
        refreshToken,
      });
    } catch {
      // Network-level failure, which now includes the request outrunning
      // TOKEN_REQUEST_TIMEOUT_MS. The refresh token is still presumed valid, so
      // it stays exactly where it is; the next command can try again.
      this.refreshFailure = 'NETWORK';
      return null;
    }

    if (parsed.kind === 'invalidGrant') {
      this.clear();
      this.reconnectRequired = true;
      return null;
    }
    if (parsed.kind !== 'success') return null;

    this.acceptTokens(parsed.tokens);
    this.reconnectRequired = false;
    return this.accessToken;
  }

  private async postToken(body: Record<string, unknown>): Promise<ParsedTokenResponse> {
    const doFetch = this.deps.fetch ?? globalThis.fetch;
    const response = await doFetch(`${this.baseUrl()}/api/auth/desktop/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    return parseTokenResponse(response);
  }

  /**
   * A failed save is reported, never thrown: a long-running `agentteams mcp`
   * that rotates its refresh token must keep running on the in-memory copy
   * rather than die at the rotation.
   */
  private acceptTokens(tokens: TokenResponse): CredentialSaveOutcome {
    this.accessToken = tokens.accessToken;
    // TTL is the server's call (`ACCESS_TOKEN_TTL_MS` in api/src/services/personalToken.ts);
    // the client never assumes a duration of its own.
    this.accessExpiresAt = this.now() + tokens.expiresIn * 1000;
    this.identity = tokens.identity;
    return this.deps.store.save(tokens.refreshToken);
  }

  private clear(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.identity = null;
    this.reconnectRequired = false;
    this.refreshFailure = null;
    this.deps.store.remove();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private baseUrl(): string {
    return this.deps.apiUrl.replace(/\/+$/, '');
  }
}

/**
 * One client per API server for the lifetime of the process.
 *
 * The in-flight refresh suppression and the cached access token only work if
 * every caller shares the same instance — a per-call client would rotate the
 * refresh token once per command, and `agentteams mcp` would do it per tool call.
 */
const clients = new Map<string, PersonalTokenClient>();

export function getPersonalTokenClient(apiUrl: string): PersonalTokenClient {
  const key = apiUrl.replace(/\/+$/, '');
  let client = clients.get(key);
  if (!client) {
    const slot = personalTokenSlot(key);
    client = new PersonalTokenClient({
      apiUrl: key,
      store: createPersonalTokenStore(key),
      // Per slot, so a dev-API rotation never blocks a production one.
      lock: createFileRefreshLock(slot),
    });
    clients.set(key, client);
  }
  return client;
}

/** Test-only: drop every cached client so a test can inject its own deps. */
export function resetPersonalTokenClientsForTests(): void {
  clients.clear();
}
