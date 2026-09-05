import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { setActiveCredential, setInjectedPersonalTokenRefreshBlockReason } from '../auth/activeCredential.js';
import { getPersonalTokenClient, } from '../auth/personalTokenClient.js';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from './git.js';
import { canonicalizePath } from './path.js';
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
export const DEFAULT_API_URL = 'https://api.agentteams.run';
/** Local config may contain a legacy API key, so it must not be group- or world-readable. */
export const CONFIG_FILE_MODE = 0o600;
const CONFIGURATION_NOT_FOUND_MESSAGE = "Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.";
function readConfigFile(filePath) {
    try {
        if (!existsSync(filePath))
            return null;
        const raw = readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Read only the repository/worktree config, without environment or global fallbacks. */
export function loadProjectConfig(startDir = process.cwd()) {
    const projectPath = findProjectConfig(startDir);
    return projectPath ? readConfigFile(projectPath) : null;
}
/**
 * Load config values from environment variables.
 * Only includes fields that have corresponding env vars set.
 *
 * Mapping:
 *   AGENTTEAMS_API_KEY    → apiKey
 *   AGENTTEAMS_API_URL    → apiUrl
 *   AGENTTEAMS_TEAM_ID    → teamId
 *   AGENTTEAMS_PROJECT_ID → projectId
 */
function loadEnvConfig() {
    const env = {};
    if (process.env.AGENTTEAMS_API_KEY)
        env.apiKey = process.env.AGENTTEAMS_API_KEY;
    if (process.env.AGENTTEAMS_API_URL)
        env.apiUrl = process.env.AGENTTEAMS_API_URL;
    if (process.env.AGENTTEAMS_TEAM_ID)
        env.teamId = process.env.AGENTTEAMS_TEAM_ID;
    if (process.env.AGENTTEAMS_PROJECT_ID)
        env.projectId = process.env.AGENTTEAMS_PROJECT_ID;
    return env;
}
/**
 * Find the nearest .agentteams/config.json by walking up from startDir to root.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to config.json, or null if not found
 */
export function findProjectConfig(startDir) {
    let current = resolve(startDir);
    const repositoryRoot = resolveGitTopLevel(current);
    if (repositoryRoot) {
        try {
            current = canonicalizePath(current);
        }
        catch {
            return null;
        }
    }
    while (true) {
        const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(candidate))
            return candidate;
        // Repository-scoped lookup must not silently adopt a parent project's or $HOME config.
        if (repositoryRoot && current === repositoryRoot)
            break;
        const parent = dirname(current);
        if (parent === current)
            break; // reached filesystem root
        current = parent;
    }
    const mainCheckoutRoot = repositoryRoot ? resolveMainCheckoutRoot(repositoryRoot) : null;
    if (mainCheckoutRoot) {
        const mainCheckoutConfig = join(mainCheckoutRoot, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(mainCheckoutConfig))
            return mainCheckoutConfig;
    }
    return null;
}
export function getConfigurationNotFoundMessage(startDir = process.cwd(), userHomeDir = homedir()) {
    const repositoryRoot = resolveGitTopLevel(resolve(startDir));
    if (!repositoryRoot)
        return CONFIGURATION_NOT_FOUND_MESSAGE;
    const homeDir = canonicalizePath(resolve(userHomeDir));
    let current = dirname(repositoryRoot);
    while (current !== homeDir) {
        const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(candidate) && resolveGitTopLevel(current) === null) {
            return `${CONFIGURATION_NOT_FOUND_MESSAGE} A parent workspace config was found outside this repository. Run 'agentteams doctor' from the workspace root to materialize .agentteams.`;
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return CONFIGURATION_NOT_FOUND_MESSAGE;
}
/**
 * Load configuration with priority-based merging.
 *
 * Priority (highest → lowest):
 *   1. CLI options (passed as argument)
 *   2. Environment variables (AGENTTEAMS_*)
 *   3. Project config (.agentteams/config.json in nearest ancestor)
 *   4. Global config (~/.agentteams/config.json)
 *
 * @param options - CLI argument overrides (highest priority)
 * @returns Merged Config if all required fields are present, otherwise null
 */
function mergeConfigSources(options) {
    const globalPath = join(homedir(), CONFIG_DIR, CONFIG_FILE);
    const globalConfig = readConfigFile(globalPath) ?? {};
    const projectConfig = loadProjectConfig() ?? {};
    const envConfig = loadEnvConfig();
    const cliOptions = options ?? {};
    return {
        apiUrl: DEFAULT_API_URL,
        ...globalConfig,
        ...projectConfig,
        ...envConfig,
        ...cliOptions,
    };
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
/**
 * The merge above, gated on a `key_` being present.
 *
 * ⚠️ Not for command paths. A personal-login project writes no `apiKey`, so this
 * returns null there and the caller reports a configured project as "run
 * `agentteams init` first". Use {@link loadConfigWithCredential} to run a
 * command, or {@link loadConfigIdentity} when only the project binding matters.
 */
export function loadConfig(options) {
    const merged = mergeConfigSources(options);
    const requiredFields = ['teamId', 'projectId', 'apiKey'];
    const hasAllFields = requiredFields.every((field) => isNonEmptyString(merged[field]));
    if (!hasAllFields)
        return null;
    return merged;
}
export function loadConfigIdentity(options) {
    const merged = mergeConfigSources(options);
    if (!isNonEmptyString(merged.teamId) || !isNonEmptyString(merged.projectId))
        return null;
    return {
        teamId: merged.teamId,
        projectId: merged.projectId,
        apiUrl: merged.apiUrl,
        ...(merged.authMode ? { authMode: merged.authMode } : {}),
    };
}
export class CredentialResolutionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CredentialResolutionError';
    }
}
export const INJECTED_PERSONAL_TOKEN_MEMBER_ID_ENV = 'AGENTTEAMS_MCP_MEMBER_ID';
let legacyApiKeyWarningPrinted = false;
function warnAboutLegacyApiKey() {
    if (legacyApiKeyWarningPrinted)
        return;
    legacyApiKeyWarningPrinted = true;
    process.stderr.write("[warn] This project still stores a legacy key_ credential in .agentteams/config.json. Run 'agentteams auth login', verify it with 'agentteams auth status', then remove apiKey from the project config.\n");
}
/** Reset only the process-level warning latch used by isolated tests. */
export function resetLegacyApiKeyWarningForTest() {
    legacyApiKeyWarningPrinted = false;
}
/** An explicit flag or environment variable wins over anything stored on disk or in a keychain. */
function explicitApiKey(options) {
    if (isNonEmptyString(options?.apiKey))
        return options.apiKey;
    if (isNonEmptyString(process.env.AGENTTEAMS_API_KEY))
        return process.env.AGENTTEAMS_API_KEY;
    return undefined;
}
/**
 * Priority, highest first:
 *   1. `--api-key` / `AGENTTEAMS_API_KEY` — the CI path, and an explicit
 *      override always beats stored state.
 *   2. A personal token from the credential store — but **only** when the
 *      project opted in (`authMode: 'personal-token'`) or there is no `key_` to
 *      fall back to. A project that still carries an agent key must never pay
 *      for a keychain lookup, let alone be blocked by one that fails.
 *   3. The `key_` in `.agentteams/config.json` — the original path, unchanged.
 */
export function planCredential(options) {
    const merged = mergeConfigSources(options);
    const explicit = explicitApiKey(options);
    if (explicit)
        return { source: 'explicit-api-key', apiKey: explicit, apiUrl: merged.apiUrl };
    const configApiKey = isNonEmptyString(merged.apiKey) ? merged.apiKey : undefined;
    const optedIn = merged.authMode === 'personal-token';
    if (optedIn || !configApiKey) {
        return {
            source: 'personal-token',
            apiUrl: merged.apiUrl,
            optedIn,
            ...(configApiKey ? { fallbackApiKey: configApiKey } : {}),
        };
    }
    return { source: 'config-api-key', apiKey: configApiKey, apiUrl: merged.apiUrl };
}
/**
 * Explain a stored credential that could not be turned into an access token.
 *
 * The distinction is worth carrying: telling someone to check a network that is
 * fine, or to re-login with a credential that is valid, costs them the time it
 * takes to rule those out. The same applies when the current directory has no
 * project binding: point at the missing binding only when the login itself is
 * usable. A concrete refresh failure still has to win because binding a project
 * cannot repair a revoked login, a lock failure, or an unreachable server.
 * Lock contention and an unusable lock both clear on a retry, so neither should
 * read as "your login is broken".
 */
export function describeUnusableCredential(state, context = {}) {
    if (state.reconnectRequired) {
        return "Your AgentTeams login was revoked or expired. Run 'agentteams auth login' to sign in again.";
    }
    switch (state.refreshFailure) {
        case 'LOCK_CONTENTION':
            return 'Another agentteams process is refreshing this login and did not finish in time. Your credential is intact — retry the command.';
        case 'LOCK_UNAVAILABLE':
            return 'Could not maintain the lock that keeps concurrent logins from clashing (check free space and permissions on ~/.agentteams/locks). Your credential is intact — retry the command.';
        case 'NETWORK':
            return "Could not refresh your AgentTeams login. Check your network connection, then retry or run 'agentteams auth login'.";
        default:
            return context.projectConnected === false
                ? "No AgentTeams project is connected to this directory. Run the command from a project directory, or run 'agentteams init' here to connect one."
                : "Could not refresh your AgentTeams login. Check your network connection, then retry or run 'agentteams auth login'.";
    }
}
/** Decide which credential to authenticate with, and produce the value to send. */
export async function resolveCredential(options, deps = {}) {
    const plan = planCredential(options);
    if (plan.source === 'explicit-api-key') {
        if (plan.apiKey.startsWith('atp_')) {
            const expectedMemberId = process.env[INJECTED_PERSONAL_TOKEN_MEMBER_ID_ENV]?.trim();
            if (!expectedMemberId) {
                setActiveCredential(null);
                setInjectedPersonalTokenRefreshBlockReason('IDENTITY_MISSING');
                return { source: 'explicit-api-key', apiKey: plan.apiKey };
            }
            const client = (deps.getClient ?? getPersonalTokenClient)(plan.apiUrl);
            if (!client.hasCredential()) {
                setActiveCredential(null);
                setInjectedPersonalTokenRefreshBlockReason('CLI_CREDENTIAL_MISSING');
                return { source: 'explicit-api-key', apiKey: plan.apiKey };
            }
            const resolveMatchingToken = async () => {
                const accessToken = await client.getAccessToken();
                if (!accessToken) {
                    setInjectedPersonalTokenRefreshBlockReason('CLI_CREDENTIAL_UNAVAILABLE');
                    return null;
                }
                if (client.state().identity?.memberId !== expectedMemberId) {
                    client.invalidateAccessToken();
                    setActiveCredential(null);
                    setInjectedPersonalTokenRefreshBlockReason('IDENTITY_MISMATCH');
                    return null;
                }
                setActiveCredential(refreshableCredential);
                return accessToken;
            };
            const refreshableCredential = {
                resolve: resolveMatchingToken,
                refresh: async () => {
                    client.invalidateAccessToken();
                    return resolveMatchingToken();
                },
            };
            // 일시 실패여도 MCP 컨텍스트가 같은 resolver로 재시도할 수 있어야 한다.
            setActiveCredential(refreshableCredential);
            const accessToken = await resolveMatchingToken();
            if (!accessToken) {
                if (client.state().identity && client.state().identity?.memberId !== expectedMemberId) {
                    throw new CredentialResolutionError("The Desktop personal token and the stored CLI login belong to different members. Run 'agentteams auth login' with the same account used in AgentTeams Desktop.");
                }
                return { source: 'explicit-api-key', apiKey: plan.apiKey, refreshable: true };
            }
            return { source: 'explicit-api-key', apiKey: plan.apiKey, refreshable: true };
        }
        setActiveCredential(null);
        return { source: 'explicit-api-key', apiKey: plan.apiKey };
    }
    const configApiKey = plan.source === 'personal-token' ? plan.fallbackApiKey : plan.apiKey;
    // The warning belongs here, not in `planCredential`. Planning is a pure decision that
    // callers make without authenticating — `mcp config` renders a snippet and touches no
    // file — and attaching stderr output to it made those commands nag about a key they
    // never read.
    if (configApiKey) {
        warnAboutLegacyApiKey();
    }
    if (plan.source === 'personal-token') {
        const optedIn = plan.optedIn;
        const client = (deps.getClient ?? getPersonalTokenClient)(plan.apiUrl);
        if (client.hasCredential()) {
            const accessToken = await client.getAccessToken();
            if (accessToken) {
                // Only this branch arms the HTTP layer's 401 retry. A `key_` has nothing
                // to refresh, so leaving the slot empty is the guard.
                setActiveCredential({
                    resolve: () => client.getAccessToken(),
                    refresh: async () => {
                        client.invalidateAccessToken();
                        return client.getAccessToken();
                    },
                });
                const expiresAt = client.state().expiresAt;
                return expiresAt === null
                    ? { source: 'personal-token', apiKey: accessToken, refreshable: true }
                    : { source: 'personal-token', apiKey: accessToken, expiresAt, refreshable: true };
            }
            // A stored-but-unusable token is only fatal when there is nothing else to
            // try; otherwise the `key_` below still works and the user sees nothing.
            if (!configApiKey) {
                throw new CredentialResolutionError(describeUnusableCredential(client.state()));
            }
        }
        else if (optedIn && !configApiKey) {
            throw new CredentialResolutionError("This project is configured to use a personal login, but no credential is stored. Run 'agentteams auth login'.");
        }
    }
    setActiveCredential(null);
    return configApiKey ? { source: 'config-api-key', apiKey: configApiKey } : null;
}
/**
 * `loadConfig()` plus credential resolution.
 *
 * The credential is substituted into `apiKey` at load time on purpose: `Config.apiKey`
 * stays a required `string`, so every command and every `resolveApiContext()` call
 * downstream is untouched by the new auth path.
 */
export async function loadConfigWithCredential(options, deps = {}) {
    const merged = mergeConfigSources(options);
    if (!isNonEmptyString(merged.teamId) || !isNonEmptyString(merged.projectId))
        return null;
    const credential = await resolveCredential(options, deps);
    if (!credential)
        return null;
    return {
        ...merged,
        apiKey: credential.apiKey,
        credentialSource: credential.source,
        credentialRefreshable: credential.refreshable === true,
    };
}
/**
 * Flip a project between the two auth paths without disturbing anything else in
 * its config file.
 *
 * `saveConfig` rewrites the whole document from a typed shape, which would drop
 * any field this CLI version does not know about — including one a newer CLI
 * wrote. Removing `authMode` (on logout) is what lets a project fall back to the
 * `key_` it may still have.
 */
export function setProjectAuthMode(configPath, authMode) {
    const existing = readConfigFile(configPath);
    if (!existing)
        return false;
    const next = { ...existing };
    if (authMode) {
        next.authMode = authMode;
    }
    else {
        delete next.authMode;
    }
    writeConfigDocument(configPath, next);
    return true;
}
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
export function saveConfig(configPath, config) {
    writeConfigDocument(configPath, config);
}
/** Compatibility-only persistence for an explicit `agentteams init --auth api-key`. */
export function saveLegacyApiKeyConfig(configPath, config) {
    writeConfigDocument(configPath, config);
}
function writeConfigDocument(configPath, config) {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const body = JSON.stringify(config, null, 2) + '\n';
    // Same directory as the target: `rename` is only atomic within a filesystem.
    const temporaryPath = join(dir, `.${Date.now().toString(36)}-${process.pid}.agentteams-tmp`);
    try {
        // `mode` on open is masked by umask, so chmod restates it unconditionally.
        writeFileSync(temporaryPath, body, { encoding: 'utf-8', mode: CONFIG_FILE_MODE });
        chmodSync(temporaryPath, CONFIG_FILE_MODE);
        renameSync(temporaryPath, configPath);
    }
    catch (error) {
        try {
            unlinkSync(temporaryPath);
        }
        catch {
            // The temp file may never have been created; the original is untouched either way.
        }
        throw error;
    }
}
/**
 * Machine-wide default for the device-code login flow.
 *
 * Deliberately **not** part of {@link PersistedConfig}: whether this machine can
 * reach a browser is a property of the machine, not of a project. Keeping the key
 * out of that type means there is no code path — not even an accidental one —
 * through which `saveConfig()` could write it into a project config.
 *
 * Two more reasons the project config is the wrong home for it:
 *  - The first `init` on a new server runs in a folder that has no project config
 *    yet, which is exactly the moment this preference has to be readable.
 *  - `auth login` has no project at all; the credential is machine-scoped.
 *
 * This is a **declaration**, not environment detection: the user either sets the
 * env var or runs `--set-default`. Nothing here inspects SSH/container/WSL state.
 */
const GLOBAL_DEVICE_AUTH_KEY = 'deviceAuth';
export function globalConfigPath(userHomeDir = homedir()) {
    return join(userHomeDir, CONFIG_DIR, CONFIG_FILE);
}
/**
 * Read the machine-wide device-auth default.
 *
 * Reads the global file and the environment only — it does **not** go through
 * {@link mergeConfigSources}, so a stray `deviceAuth` key in a project config is
 * ignored rather than silently changing that project's login flow.
 */
export function isDeviceAuthDefaultEnabled(userHomeDir = homedir()) {
    const envValue = process.env.AGENTTEAMS_DEVICE_AUTH?.trim().toLowerCase();
    if (envValue !== undefined && envValue.length > 0) {
        return envValue === '1' || envValue === 'true' || envValue === 'yes';
    }
    const globalConfig = readConfigFile(globalConfigPath(userHomeDir));
    return globalConfig?.[GLOBAL_DEVICE_AUTH_KEY] === true;
}
/**
 * Set or clear the machine-wide device-auth default in `~/.agentteams/config.json`.
 *
 * Read-merge-write so the other keys in the global config survive; the file is
 * created (with the directory) when it does not exist yet. Only ever called from
 * an explicit `--set-default`, never as a side effect of a successful login —
 * "just this once" must not turn into a permanent setting.
 */
export function setDeviceAuthDefault(enabled, userHomeDir = homedir()) {
    const path = globalConfigPath(userHomeDir);
    const current = readConfigFile(path) ?? {};
    const next = { ...current };
    if (enabled) {
        next[GLOBAL_DEVICE_AUTH_KEY] = true;
    }
    else {
        delete next[GLOBAL_DEVICE_AUTH_KEY];
    }
    writeConfigDocument(path, next);
    return path;
}
//# sourceMappingURL=config.js.map