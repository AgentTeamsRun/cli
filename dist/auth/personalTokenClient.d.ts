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
import type { CredentialBackendId, CredentialStoreReason } from './credentialStore.js';
import { type PersonalTokenStore } from './personalTokenStore.js';
import { type RefreshLock } from './refreshLock.js';
/** Registered in `api/src/services/personalTokenClients.ts`; the server rejects anything else. */
export declare const CLI_OAUTH_CLIENT_ID = "agentteams-cli";
/** Refresh this far before the server-declared expiry rather than at it. */
export declare const ACCESS_REFRESH_SKEW_MS = 60000;
/**
 * Cap on a token-endpoint request.
 *
 * Deliberately below {@link DEFAULT_STALE_AFTER_MS}: a rotation runs with the
 * cross-process lock held, and if it could outlast the staleness window another
 * process would judge the lock abandoned, take it, and rotate the same refresh
 * token — the reuse that revokes the whole family. Bounding the request keeps the
 * holder inside the window it promised.
 */
export declare const TOKEN_REQUEST_TIMEOUT_MS: number;
export type PersonalTokenErrorCode = 'INVALID_GRANT' | 'TRANSIENT' | 'NOT_LOGGED_IN' | 'MALFORMED_RESPONSE' | 'REVOKE_FAILED'
/** A fresh login succeeded but the credential could not be kept anywhere durable. */
 | 'STORE_UNAVAILABLE';
export declare class PersonalTokenError extends Error {
    readonly code: PersonalTokenErrorCode;
    constructor(code: PersonalTokenErrorCode, message: string);
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
    /** Which store holds this slot, regardless of whether it currently works. */
    storeBackend: CredentialBackendId;
    storeReason: CredentialStoreReason;
    /**
     * Why that backend, when the store had something to say — a rejected write, or
     * the reason the OS store was skipped in favour of the file fallback. Absent
     * on the ordinary path, where the backend name is the whole story.
     */
    storeDetail?: string;
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
type ParsedTokenResponse = {
    kind: 'success';
    tokens: TokenResponse;
} | {
    kind: 'invalidGrant';
} | {
    kind: 'transient';
    detail: string;
};
/**
 * Classify a token-endpoint response.
 *
 * The split that matters is `invalid_grant` (the server has definitively
 * refused this refresh token) versus everything else (5xx, a proxy error page,
 * a truncated body). Only the first justifies destroying local credentials.
 */
export declare function parseTokenResponse(response: Response): Promise<ParsedTokenResponse>;
/** `flow: 'setup'` result the approval screen chose; `init` writes these into the project config. */
export interface DeviceSetupResult {
    teamId: string;
    projectId: string;
    agentConfigId: string;
    agentName: string;
    seedPlanId: string | null;
}
/**
 * One poll's outcome, in the server's own vocabulary (RFC 8628 error codes).
 *
 * `transient` is deliberately separate from `denied`/`expired`: only the latter
 * two are decisions, and treating a dropped connection as a decision would end a
 * login the user is still completing.
 */
export type DevicePollOutcome = {
    kind: 'approved';
    session: PersonalTokenSession;
    setup: DeviceSetupResult | null;
} | {
    kind: 'pending';
} | {
    kind: 'slowDown';
    intervalSeconds: number | null;
} | {
    kind: 'denied';
} | {
    kind: 'expired';
} | {
    kind: 'invalid';
} | {
    kind: 'transient';
    detail: string;
};
export declare class PersonalTokenClient {
    private readonly deps;
    private accessToken;
    private accessExpiresAt;
    private identity;
    private reconnectRequired;
    private refreshFailure;
    private refreshInFlight;
    constructor(deps: PersonalTokenClientDeps);
    state(): PersonalTokenState;
    hasCredential(): boolean;
    /**
     * One poll of the RFC 8628 device token endpoint.
     *
     * Lives here rather than in the polling loop because the *storage* invariants
     * are the same as a PKCE exchange: a credential the next process cannot find
     * is not a login, so an unstorable token pair is revoked instead of orphaned.
     * The loop only decides *when* to call this; the outcome vocabulary below is
     * the server's error contract verbatim.
     */
    pollDeviceToken(deviceCode: string): Promise<DevicePollOutcome>;
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
    exchangeAuthorizationCode(grant: AuthorizationCodeGrant): Promise<PersonalTokenSession>;
    /**
     * Undo a login whose credential could not be stored.
     *
     * Revoking is best-effort — an unreachable server is not a reason to keep a
     * dangling local state — but the local copy always goes, so `hasCredential()`
     * never reports a login the next process will not find.
     */
    private discardUnstorableTokens;
    /**
     * Current access token, refreshing pre-emptively when it is close to expiry.
     * Returns null when there is nothing usable — the caller decides whether that
     * is a hard failure or a reason to fall back to another credential.
     */
    getAccessToken(): Promise<string | null>;
    /** Force the next {@link getAccessToken} to refresh even if the cached token looks fresh. */
    invalidateAccessToken(): void;
    /**
     * Revoke the token family server-side, then drop the local copy.
     *
     * The order is not negotiable: clearing first and failing the revoke would
     * leave a live refresh token on the server that the user can no longer see or
     * cancel.
     */
    revoke(): Promise<void>;
    /**
     * Drop the local credential without asking the server.
     *
     * The offline escape hatch behind `auth logout --local`: the token stays valid
     * server-side, so the caller owes the user a "revoke it in the web app" note.
     */
    forgetLocalCredential(): void;
    private refresh;
    /** The rotation itself. Runs with the cross-process lock held. */
    private rotate;
    private postToken;
    /**
     * A failed save is reported, never thrown: a long-running `agentteams mcp`
     * that rotates its refresh token must keep running on the in-memory copy
     * rather than die at the rotation.
     */
    private acceptTokens;
    private clear;
    private now;
    private baseUrl;
}
export declare function getPersonalTokenClient(apiUrl: string): PersonalTokenClient;
/** Test-only: drop every cached client so a test can inject its own deps. */
export declare function resetPersonalTokenClientsForTests(): void;
export {};
//# sourceMappingURL=personalTokenClient.d.ts.map