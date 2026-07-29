import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from '../types/index.js';
import { setActiveCredential } from '../auth/activeCredential.js';
import { getPersonalTokenClient, type PersonalTokenClient } from '../auth/personalTokenClient.js';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from './git.js';
import { canonicalizePath } from './path.js';

const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
export const DEFAULT_API_URL = 'https://api.agentteams.run';

/** The config file holds a long-lived API key, so it must not be group- or world-readable. */
export const CONFIG_FILE_MODE = 0o600;
export type PersistedConfig = Pick<Config, 'teamId' | 'projectId'> &
  Partial<Pick<Config, 'apiKey' | 'apiUrl' | 'authMode'>>;

const CONFIGURATION_NOT_FOUND_MESSAGE =
  "Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.";

function readConfigFile(filePath: string): Partial<Config> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return null;
  }
}

/** Read only the repository/worktree config, without environment or global fallbacks. */
export function loadProjectConfig(startDir: string = process.cwd()): Partial<Config> | null {
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
function loadEnvConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.AGENTTEAMS_API_KEY) env.apiKey = process.env.AGENTTEAMS_API_KEY;
  if (process.env.AGENTTEAMS_API_URL) env.apiUrl = process.env.AGENTTEAMS_API_URL;
  if (process.env.AGENTTEAMS_TEAM_ID) env.teamId = process.env.AGENTTEAMS_TEAM_ID;
  if (process.env.AGENTTEAMS_PROJECT_ID) env.projectId = process.env.AGENTTEAMS_PROJECT_ID;

  return env;
}

/**
 * Find the nearest .agentteams/config.json by walking up from startDir to root.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to config.json, or null if not found
 */
export function findProjectConfig(startDir: string): string | null {
  let current = resolve(startDir);
  const repositoryRoot = resolveGitTopLevel(current);

  if (repositoryRoot) {
    try {
      current = canonicalizePath(current);
    } catch {
      return null;
    }
  }

  while (true) {
    const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;

    // Repository-scoped lookup must not silently adopt a parent project's or $HOME config.
    if (repositoryRoot && current === repositoryRoot) break;

    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  const mainCheckoutRoot = repositoryRoot ? resolveMainCheckoutRoot(repositoryRoot) : null;
  if (mainCheckoutRoot) {
    const mainCheckoutConfig = join(mainCheckoutRoot, CONFIG_DIR, CONFIG_FILE);
    if (existsSync(mainCheckoutConfig)) return mainCheckoutConfig;
  }

  return null;
}

export function getConfigurationNotFoundMessage(
  startDir: string = process.cwd(),
  userHomeDir: string = homedir(),
): string {
  const repositoryRoot = resolveGitTopLevel(resolve(startDir));
  if (!repositoryRoot) return CONFIGURATION_NOT_FOUND_MESSAGE;

  const homeDir = canonicalizePath(resolve(userHomeDir));
  let current = dirname(repositoryRoot);

  while (current !== homeDir) {
    const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
    if (existsSync(candidate) && resolveGitTopLevel(current) === null) {
      return `${CONFIGURATION_NOT_FOUND_MESSAGE} A parent workspace config was found outside this repository. Run 'agentteams doctor' from the workspace root to materialize .agentteams.`;
    }

    const parent = dirname(current);
    if (parent === current) break;
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
function mergeConfigSources(options?: Partial<Config>): Partial<Config> & { apiUrl: string } {
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

function isNonEmptyString(value: unknown): value is string {
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
export function loadConfig(options?: Partial<Config>): Config | null {
  const merged = mergeConfigSources(options);

  const requiredFields: (keyof Config)[] = ['teamId', 'projectId', 'apiKey'];

  const hasAllFields = requiredFields.every((field) => isNonEmptyString(merged[field]));

  if (!hasAllFields) return null;

  return merged as Config;
}

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

export function loadConfigIdentity(options?: Partial<Config>): ConfigIdentity | null {
  const merged = mergeConfigSources(options);
  if (!isNonEmptyString(merged.teamId) || !isNonEmptyString(merged.projectId)) return null;

  return {
    teamId: merged.teamId,
    projectId: merged.projectId,
    apiUrl: merged.apiUrl,
    ...(merged.authMode ? { authMode: merged.authMode } : {}),
  };
}

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
}

export class CredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialResolutionError';
  }
}

export type ResolvedConfig = Config & { credentialSource: CredentialSource };

export interface ResolveCredentialDeps {
  /** Injection point for tests; production always uses the per-server singleton. */
  getClient?: (apiUrl: string) => PersonalTokenClient;
}

/** An explicit flag or environment variable wins over anything stored on disk or in a keychain. */
function explicitApiKey(options?: Partial<Config>): string | undefined {
  if (isNonEmptyString(options?.apiKey)) return options.apiKey;
  if (isNonEmptyString(process.env.AGENTTEAMS_API_KEY)) return process.env.AGENTTEAMS_API_KEY;
  return undefined;
}

/**
 * Which credential *would* be used, decided from config files alone.
 *
 * Split out of {@link resolveCredential} so callers that only need the choice —
 * MCP registration deciding whether to write an API key into a client config —
 * get the answer without a keychain lookup or a token refresh, and without a
 * second copy of the priority rule going stale.
 */
export type CredentialPlan =
  | { source: 'explicit-api-key'; apiKey: string; apiUrl: string }
  /**
   * `optedIn` separates "the project chose this path" from "there is no `key_`
   * left, so try it". Only the first makes a missing credential fatal.
   */
  | { source: 'personal-token'; apiUrl: string; optedIn: boolean; fallbackApiKey?: string }
  | { source: 'config-api-key'; apiKey: string; apiUrl: string };

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
export function planCredential(options?: Partial<Config>): CredentialPlan {
  const merged = mergeConfigSources(options);

  const explicit = explicitApiKey(options);
  if (explicit) return { source: 'explicit-api-key', apiKey: explicit, apiUrl: merged.apiUrl };

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

/** Decide which credential to authenticate with, and produce the value to send. */
export async function resolveCredential(
  options?: Partial<Config>,
  deps: ResolveCredentialDeps = {},
): Promise<ResolvedCredential | null> {
  const plan = planCredential(options);

  if (plan.source === 'explicit-api-key') {
    setActiveCredential(null);
    return { source: 'explicit-api-key', apiKey: plan.apiKey };
  }

  const configApiKey = plan.source === 'personal-token' ? plan.fallbackApiKey : plan.apiKey;

  if (plan.source === 'personal-token') {
    const optedIn = plan.optedIn;
    const client = (deps.getClient ?? getPersonalTokenClient)(plan.apiUrl);

    if (client.hasCredential()) {
      const accessToken = await client.getAccessToken();
      if (accessToken) {
        // Only this branch arms the HTTP layer's 401 retry. A `key_` has nothing
        // to refresh, so leaving the slot empty is the guard.
        setActiveCredential({
          refresh: async () => {
            client.invalidateAccessToken();
            return client.getAccessToken();
          },
        });
        const expiresAt = client.state().expiresAt;
        return expiresAt === null
          ? { source: 'personal-token', apiKey: accessToken }
          : { source: 'personal-token', apiKey: accessToken, expiresAt };
      }

      // A stored-but-unusable token is only fatal when there is nothing else to
      // try; otherwise the `key_` below still works and the user sees nothing.
      if (!configApiKey) {
        throw new CredentialResolutionError(
          client.state().reconnectRequired
            ? "Your AgentTeams login was revoked or expired. Run 'agentteams auth login' to sign in again."
            : "Could not refresh your AgentTeams login. Check your network connection, then retry or run 'agentteams auth login'.",
        );
      }
    } else if (optedIn && !configApiKey) {
      throw new CredentialResolutionError(
        "This project is configured to use a personal login, but no credential is stored. Run 'agentteams auth login'.",
      );
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
export async function loadConfigWithCredential(
  options?: Partial<Config>,
  deps: ResolveCredentialDeps = {},
): Promise<ResolvedConfig | null> {
  const merged = mergeConfigSources(options);
  if (!isNonEmptyString(merged.teamId) || !isNonEmptyString(merged.projectId)) return null;

  const credential = await resolveCredential(options, deps);
  if (!credential) return null;

  return { ...merged, apiKey: credential.apiKey, credentialSource: credential.source } as ResolvedConfig;
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
export function setProjectAuthMode(configPath: string, authMode: Config['authMode'] | null): boolean {
  const existing = readConfigFile(configPath);
  if (!existing) return false;

  const next: Record<string, unknown> = { ...existing };
  if (authMode) {
    next.authMode = authMode;
  } else {
    delete next.authMode;
  }

  writeConfigDocument(configPath, next);
  return true;
}

/**
 * Save configuration to a JSON file.
 * Creates parent directories if they don't exist.
 *
 * The file carries an API key, so it is written through a temp file in the same
 * directory and renamed into place: a crash or a full disk can never leave a
 * truncated config behind, and the key is never briefly visible at a wider mode.
 * The result is always {@link CONFIG_FILE_MODE}; repairing configs this function
 * does not write is `agentteams doctor`'s job, not this one's.
 *
 * @param configPath - Absolute path to write the config file
 * @param config - Configuration object to persist
 * @throws Error if write fails
 */
export function saveConfig(configPath: string, config: PersistedConfig): void {
  writeConfigDocument(configPath, config);
}

function writeConfigDocument(configPath: string, config: object): void {
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
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temp file may never have been created; the original is untouched either way.
    }
    throw error;
  }
}
