/**
 * `agentteams auth login | status | logout`.
 *
 * The default authentication path for new projects and the migration path for
 * legacy configs. The stored credential is picked up by `resolveCredential()`
 * when the config has no `key_`, or when a migrated legacy project carries
 * `authMode: 'personal-token'`.
 */
import type { CredentialBackendId, CredentialStoreReason } from '../auth/credentialStore.js';
import type { Config } from '../types/index.js';
import { type CredentialSource } from '../utils/config.js';
export type AuthLoginResult = {
    success: true;
    authUrl: string;
    apiUrl: string;
    identity: {
        memberId: string;
        email: string;
        nickname: string;
    };
    /**
     * Always true on success: a login that could not be persisted is rejected and
     * revoked inside `exchangeAuthorizationCode` rather than reported as a
     * half-login. The field stays in the payload because scripts read it.
     */
    persisted: boolean;
    /** Which OS store holds the credential — the same vocabulary as `auth status`. */
    storeBackend: CredentialBackendId;
    storeReason: CredentialStoreReason;
    configPath: string | null;
    authMode: 'personal-token';
    warning?: string;
};
export type AuthStatusResult = {
    apiUrl: string;
    configPath: string | null;
    /** Which credential the next command would authenticate with. */
    credentialSource: CredentialSource | null;
    authMode: Config['authMode'] | null;
    hasProjectApiKey: boolean;
    personalToken: {
        connected: boolean;
        persisted: boolean;
        storeBackend: CredentialBackendId;
        storeReason: CredentialStoreReason;
        reconnectRequired: boolean;
        identity: {
            memberId: string;
            email: string;
            nickname: string;
        } | null;
        expiresAt: string | null;
    };
    problem?: string;
};
export type AuthLogoutResult = {
    success: true;
    apiUrl: string;
    configPath: string | null;
    /** false → the token is still live server-side (`--local`, or nothing was stored). */
    revokedOnServer: boolean;
    /** true when the project reverted to an `agentteams init` API key that is still on disk. */
    fellBackToApiKey: boolean;
    warning?: string;
};
/**
 * Where to log in. Unlike the legacy `init` path this honours the project's own
 * `apiUrl`, because a refresh token issued by the dev API is worthless against
 * production and storing it under the wrong server would silently fail later.
 */
export declare function resolveAuthApiUrl(options?: {
    apiUrl?: string;
}): string;
export declare function buildPersonalTokenAuthorizeUrl(input: {
    port: number;
    state: string;
    codeChallenge: string;
    projectName?: string;
}): string;
/**
 * Run the browser round trip and exchange the resulting code for tokens.
 *
 * Exported so `init --auth personal-token` reuses the identical flow rather than
 * growing a second copy of the PKCE handshake.
 */
export declare function performPersonalTokenLogin(input: {
    apiUrl: string;
    projectName?: string;
}): Promise<{
    authUrl: string;
    identity: AuthLoginResult['identity'];
    persisted: boolean;
    storeBackend: CredentialBackendId;
    storeReason: CredentialStoreReason;
}>;
export declare function executeAuthCommand(action: string, options?: Record<string, unknown>): Promise<unknown>;
//# sourceMappingURL=auth.d.ts.map