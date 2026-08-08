import type { Config } from '../types/index.js';
import { type PersonalTokenClient, type PersonalTokenState } from '../auth/personalTokenClient.js';
export declare const DEFAULT_API_URL = "https://api.agentteams.run";
/** Local config may contain a legacy API key, so it must not be group- or world-readable. */
export declare const CONFIG_FILE_MODE = 384;
export type PersistedConfig = Pick<Config, 'teamId' | 'projectId'> & Partial<Pick<Config, 'apiUrl' | 'authMode'>>;
export type LegacyApiKeyPersistedConfig = PersistedConfig & Pick<Config, 'apiKey'>;
/** Read only the repository/worktree config, without environment or global fallbacks. */
export declare function loadProjectConfig(startDir?: string): Partial<Config> | null;
/**
 * Find the nearest .agentteams/config.json by walking up from startDir to root.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to config.json, or null if not found
 */
export declare function findProjectConfig(startDir: string): string | null;
export declare function getConfigurationNotFoundMessage(startDir?: string, userHomeDir?: string): string;
/**
 * The merge above, gated on a `key_` being present.
 *
 * ⚠️ Not for command paths. A personal-login project writes no `apiKey`, so this
 * returns null there and the caller reports a configured project as "run
 * `agentteams init` first". Use {@link loadConfigWithCredential} to run a
 * command, or {@link loadConfigIdentity} when only the project binding matters.
 */
export declare function loadConfig(options?: Partial<Config>): Config | null;
/**
 * The project binding on its own — no credential required.
 *
 * A personal-token project keeps no `apiKey` on disk, so `loadConfig()` reports
 * it as uninitialized. Callers that only need to know *which* project this is
 * (MCP registration renders the binding into a client config) ask for this
 * instead of forcing a keychain round trip they have no use for.
 */
export interface ConfigIdentity {
    teamId: string;
    projectId: string;
    apiUrl: string;
    authMode?: Config['authMode'];
}
export declare function loadConfigIdentity(options?: Partial<Config>): ConfigIdentity | null;
/**
 * Which credential the CLI is about to authenticate with.
 *
 * `auth status` reports this verbatim, so the choice must never be implicit —
 * "why is my key not being used" is unanswerable otherwise.
 */
export type CredentialSource = 'explicit-api-key' | 'personal-token' | 'config-api-key';
export interface ResolvedCredential {
    source: CredentialSource;
    /**
     * The value that goes on the wire. `apiContext.buildAuthHeaders()` picks the
     * header from the prefix (`key_` → `X-API-Key`, otherwise `Bearer`), which is
     * exactly why a personal access token can be handed over in the same slot and
     * the HTTP layer needs no change at all.
     */
    apiKey: string;
    expiresAt?: number;
    /** True when long-running callers can resolve a replacement access token. */
    refreshable?: true;
}
export declare class CredentialResolutionError extends Error {
    constructor(message: string);
}
export type ResolvedConfig = Config & {
    credentialSource: CredentialSource;
    credentialRefreshable: boolean;
};
export declare const INJECTED_PERSONAL_TOKEN_MEMBER_ID_ENV = "AGENTTEAMS_MCP_MEMBER_ID";
export interface ResolveCredentialDeps {
    /** Injection point for tests; production always uses the per-server singleton. */
    getClient?: (apiUrl: string) => PersonalTokenClient;
}
/** Reset only the process-level warning latch used by isolated tests. */
export declare function resetLegacyApiKeyWarningForTest(): void;
/**
 * Which credential *would* be used, decided from config files alone.
 *
 * Split out of {@link resolveCredential} so callers that only need the choice —
 * MCP registration deciding whether to write an API key into a client config —
 * get the answer without a keychain lookup or a token refresh, and without a
 * second copy of the priority rule going stale.
 */
export type CredentialPlan = {
    source: 'explicit-api-key';
    apiKey: string;
    apiUrl: string;
}
/**
 * `optedIn` separates "the project chose this path" from "there is no `key_`
 * left, so try it". Only the first makes a missing credential fatal.
 */
 | {
    source: 'personal-token';
    apiUrl: string;
    optedIn: boolean;
    fallbackApiKey?: string;
} | {
    source: 'config-api-key';
    apiKey: string;
    apiUrl: string;
};
/**
 * Priority, highest first:
 *   1. `--api-key` / `AGENTTEAMS_API_KEY` — the CI path, and an explicit
 *      override always beats stored state.
 *   2. A personal token from the OS credential store — but **only** when the
 *      project opted in (`authMode: 'personal-token'`) or there is no `key_` to
 *      fall back to. A project that still carries an agent key must never pay
 *      for a keychain lookup, let alone be blocked by one that fails.
 *   3. The `key_` in `.agentteams/config.json` — the original path, unchanged.
 */
export declare function planCredential(options?: Partial<Config>): CredentialPlan;
/**
 * Explain a stored credential that could not be turned into an access token.
 *
 * The distinction is worth carrying: telling someone to check a network that is
 * fine, or to re-login with a credential that is valid, costs them the time it
 * takes to rule those out. Lock contention and an unusable lock both clear on a
 * retry, so neither should read as "your login is broken".
 */
export declare function describeUnusableCredential(state: PersonalTokenState): string;
/** Decide which credential to authenticate with, and produce the value to send. */
export declare function resolveCredential(options?: Partial<Config>, deps?: ResolveCredentialDeps): Promise<ResolvedCredential | null>;
/**
 * `loadConfig()` plus credential resolution.
 *
 * The credential is substituted into `apiKey` at load time on purpose: `Config.apiKey`
 * stays a required `string`, so every command and every `resolveApiContext()` call
 * downstream is untouched by the new auth path.
 */
export declare function loadConfigWithCredential(options?: Partial<Config>, deps?: ResolveCredentialDeps): Promise<ResolvedConfig | null>;
/**
 * Flip a project between the two auth paths without disturbing anything else in
 * its config file.
 *
 * `saveConfig` rewrites the whole document from a typed shape, which would drop
 * any field this CLI version does not know about — including one a newer CLI
 * wrote. Removing `authMode` (on logout) is what lets a project fall back to the
 * `key_` it may still have.
 */
export declare function setProjectAuthMode(configPath: string, authMode: Config['authMode'] | null): boolean;
/**
 * Save configuration to a JSON file.
 * Creates parent directories if they don't exist.
 *
 * The document is written through a temp file in the same directory and renamed
 * into place: a crash or a full disk can never leave a truncated config behind.
 * The result is always {@link CONFIG_FILE_MODE}; repairing configs this function
 * does not write is `agentteams doctor`'s job, not this one's. This normal path
 * deliberately cannot persist `apiKey`; only the explicit legacy helper can.
 *
 * @param configPath - Absolute path to write the config file
 * @param config - Configuration object to persist
 * @throws Error if write fails
 */
export declare function saveConfig(configPath: string, config: PersistedConfig): void;
/** Compatibility-only persistence for an explicit `agentteams init --auth api-key`. */
export declare function saveLegacyApiKeyConfig(configPath: string, config: LegacyApiKeyPersistedConfig): void;
//# sourceMappingURL=config.d.ts.map