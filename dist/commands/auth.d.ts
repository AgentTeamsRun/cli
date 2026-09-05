/**
 * `agentteams auth login | status | logout`.
 *
 * The default authentication path for new projects and the migration path for
 * legacy configs. The stored credential is picked up by `resolveCredential()`
 * when the config has no `key_`, or when a migrated legacy project carries
 * `authMode: 'personal-token'`.
 */
import { type CredentialBackendId, type CredentialStoreReason } from '../auth/credentialStore.js';
import { pollDeviceAuthorization } from '../auth/deviceAuthClient.js';
import { type PersonalTokenState } from '../auth/personalTokenClient.js';
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
    /** Which store holds the credential — the same vocabulary as `auth status`. */
    storeBackend: CredentialBackendId;
    storeReason: CredentialStoreReason;
    /** Why that store, when there is more to say than its name. */
    storeDetail?: string;
    configPath: string | null;
    authMode: 'personal-token';
    /** true when this login used the device-code flow instead of the browser callback. */
    deviceAuth: boolean;
    /** Set only when `--set-default` wrote the machine-wide device-auth preference. */
    deviceAuthDefaultPath?: string;
    warning?: string;
};
export type AuthStatusResult = {
    apiUrl: string;
    configPath: string | null;
    /** Which credential the next command would authenticate with. */
    credentialSource: CredentialSource | null;
    authMode: Config['authMode'] | null;
    hasProjectApiKey: boolean;
    /**
     * Machine-wide device-auth default (`--set-default` or AGENTTEAMS_DEVICE_AUTH).
     * Reported here because otherwise there is no way to discover that this machine
     * is on the device flow, nor how to turn it back off.
     */
    deviceAuthDefault: {
        enabled: boolean;
        /** Where the preference lives, and therefore where to remove it. */
        configPath: string;
        disableHint: string;
    };
    personalToken: {
        connected: boolean;
        persisted: boolean;
        storeBackend: CredentialBackendId;
        storeReason: CredentialStoreReason;
        storeDetail?: string;
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
 * Discoverability line for the device flow.
 *
 * This is the *only* thing `isSshEnvironment()` is allowed to influence. It never
 * selects a flow: a false positive here costs one extra line of text, whereas a
 * false positive in flow selection would downgrade a working one-click login on a
 * local machine into copying a code by hand.
 */
export declare const DEVICE_AUTH_HINT = "If you cannot open that URL here, run 'agentteams auth login --device-auth' to authorize with a short code on another device instead.";
export declare const DEVICE_AUTH_INIT_HINT = "If you cannot open that URL here, run 'agentteams init --device-auth' to authorize with a short code on another device instead.";
/**
 * Whether this invocation should take the device-code path.
 *
 * Three inputs, all of them **explicit user declarations**: the flag, the env var,
 * and the machine-wide default written by `--set-default`. Nothing detects the
 * environment. Adding detection here is the one change this feature must not take:
 * a false positive strands a local user on code entry, and a false negative opens
 * a loopback port on a remote box, which is the original bug.
 */
export declare function shouldUseDeviceAuth(options: Record<string, unknown>, userHomeDir?: string): boolean;
/**
 * Run the device-code round trip.
 *
 * Exported so `init --device-auth` reuses the identical handshake instead of
 * growing a second copy of the polling state machine.
 */
export declare function performDeviceAuthLogin(input: {
    apiUrl: string;
    flow?: 'login' | 'setup';
    projectName?: string;
    osType?: string;
    machineId?: string;
    authPathEnc?: string;
    signal?: AbortSignal;
}): Promise<{
    verificationUri: string;
    identity: AuthLoginResult['identity'];
    setup: Awaited<ReturnType<typeof pollDeviceAuthorization>>['setup'];
    persisted: boolean;
    storeBackend: CredentialBackendId;
    storeReason: CredentialStoreReason;
    storeDetail?: string;
}>;
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
    storeDetail?: string;
}>;
/**
 * Attach the device-code hint to the loopback timeout.
 *
 * That timeout is exactly the failure this feature exists for: the browser
 * called back to *its own* localhost, so a login started over SSH waits 60
 * seconds and dies with no idea what to do next. The hint is added where the
 * user-facing message is built rather than inside `authServer`, so the local
 * (working) path keeps its message unchanged.
 */
export declare function decorateLoopbackTimeout(error: unknown, hint: string): unknown;
export declare function describeAuthStatusProblem(resolutionError: unknown, state: PersonalTokenState, projectConnected: boolean): string | undefined;
export declare function executeAuthCommand(action: string, options?: Record<string, unknown>): Promise<unknown>;
//# sourceMappingURL=auth.d.ts.map