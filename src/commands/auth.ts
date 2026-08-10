/**
 * `agentteams auth login | status | logout`.
 *
 * The default authentication path for new projects and the migration path for
 * legacy configs. The stored credential is picked up by `resolveCredential()`
 * when the config has no `key_`, or when a migrated legacy project carries
 * `authMode: 'personal-token'`.
 */

import open from 'open';
import { getCredentialStore, type CredentialBackendId, type CredentialStoreReason } from '../auth/credentialStore.js';
import { FILE_CREDENTIALS_DISABLED_ENV, isFileCredentialFallbackDisabled } from '../auth/fileCredentialStore.js';
import { pollDeviceAuthorization, startDeviceAuthorization } from '../auth/deviceAuthClient.js';
import { getPersonalTokenClient, PersonalTokenError } from '../auth/personalTokenClient.js';
import type { Config } from '../types/index.js';
import { startAuthorizationCodeServer, createAuthState, createPkcePair } from '../utils/authServer.js';
import {
  DEFAULT_API_URL,
  findProjectConfig,
  globalConfigPath,
  isDeviceAuthDefaultEnabled,
  loadProjectConfig,
  resolveCredential,
  setDeviceAuthDefault,
  setProjectAuthMode,
  type CredentialSource,
} from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';
import { withCommandContext } from '../utils/commandContext.js';

const AUTH_BASE_URL = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';

export type AuthLoginResult = {
  success: true;
  authUrl: string;
  apiUrl: string;
  identity: { memberId: string; email: string; nickname: string };
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
    identity: { memberId: string; email: string; nickname: string } | null;
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
export function resolveAuthApiUrl(options?: { apiUrl?: string }): string {
  const candidate =
    (typeof options?.apiUrl === 'string' && options.apiUrl.length > 0 ? options.apiUrl : undefined) ??
    process.env.AGENTTEAMS_API_URL ??
    loadProjectConfig()?.apiUrl ??
    DEFAULT_API_URL;
  return candidate.replace(/\/+$/, '');
}

export function buildPersonalTokenAuthorizeUrl(input: {
  port: number;
  state: string;
  codeChallenge: string;
  projectName?: string;
}): string {
  const params = new URLSearchParams({
    port: String(input.port),
    state: input.state,
    code_challenge: input.codeChallenge,
  });
  if (input.projectName) {
    params.set('projectName', input.projectName);
  }
  return `${AUTH_BASE_URL.replace(/\/+$/, '')}/cli/authorize?${params.toString()}`;
}

function isSshEnvironment(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

/**
 * Discoverability line for the device flow.
 *
 * This is the *only* thing `isSshEnvironment()` is allowed to influence. It never
 * selects a flow: a false positive here costs one extra line of text, whereas a
 * false positive in flow selection would downgrade a working one-click login on a
 * local machine into copying a code by hand.
 */
export const DEVICE_AUTH_HINT =
  "If you cannot open that URL here, run 'agentteams auth login --device-auth' to authorize with a short code on another device instead.";

export const DEVICE_AUTH_INIT_HINT =
  "If you cannot open that URL here, run 'agentteams init --device-auth' to authorize with a short code on another device instead.";

async function tryOpenBrowser(url: string): Promise<void> {
  console.log('🔐 Complete the AgentTeams login in your browser:');
  console.log(url);

  // Headless and SSH sessions have no browser to open; the printed URL is the
  // whole interface there, exactly as in `init`.
  if (isSshEnvironment()) {
    console.log(DEVICE_AUTH_HINT);
    return;
  }

  try {
    await open(url);
  } catch {
    // Already printed.
  }
}

/**
 * Whether this invocation should take the device-code path.
 *
 * Three inputs, all of them **explicit user declarations**: the flag, the env var,
 * and the machine-wide default written by `--set-default`. Nothing detects the
 * environment. Adding detection here is the one change this feature must not take:
 * a false positive strands a local user on code entry, and a false negative opens
 * a loopback port on a remote box, which is the original bug.
 */
export function shouldUseDeviceAuth(options: Record<string, unknown>, userHomeDir?: string): boolean {
  return options.deviceAuth === true || isDeviceAuthDefaultEnabled(userHomeDir);
}

/**
 * Refuse before asking the user to do anything.
 *
 * The compensation for an unstorable token (revoke it, report it) already exists
 * downstream, but by then the user has walked to another machine and approved a
 * request that is about to be thrown away. Checking first turns that into an
 * immediate, actionable failure.
 *
 * The store answers `OK` whenever it can persist *somehow*, including through the
 * protected-file fallback — so on a remote box this now lets the flow start
 * instead of stopping it. Reaching the refusal below means even the fallback is
 * unavailable, which on a default install only happens when it was switched off.
 */
function assertCredentialStoreUsable(): void {
  const status = getCredentialStore().status();
  if (status.reason === 'OK') return;

  const cause =
    status.reason === 'NO_BACKEND'
      ? 'this machine has no usable OS credential store'
      : status.reason === 'UNSUPPORTED_PLATFORM'
        ? 'this platform has no supported OS credential store'
        : 'the OS credential store rejected a write';

  // The diagnostic is what separates "libsecret is not installed" from
  // "libsecret is installed and exits non-zero", which look identical otherwise
  // and send the user after a package they already have. It now also carries the
  // file fallback's own reason when that is what failed.
  const diagnostic = status.detail ? ` (${status.detail})` : '';

  // Advising an unset only when the variable is actually set: on a machine where
  // the fallback failed for its own reasons, that line points at the wrong thing
  // and pushes the real diagnostic out of sight.
  const optOutAdvice = isFileCredentialFallbackDisabled(process.env)
    ? `Unset ${FILE_CREDENTIALS_DISABLED_ENV} to let this machine keep the login in a permission-protected file instead, or use `
    : 'Or use ';

  throw new PersonalTokenError(
    'STORE_UNAVAILABLE',
    `Cannot start device authorization: ${cause}${diagnostic}. ` +
      'Fix the OS credential store for your platform — on Linux install and unlock libsecret ' +
      '(for example `sudo apt install libsecret-tools` plus a running keyring), on macOS unlock the login keychain ' +
      '(`security unlock-keychain`), on Windows sign in interactively so the Credential Manager vault is available. ' +
      `${optOutAdvice}an API key (AGENTTEAMS_API_KEY) for CI, containers and other unattended runs.`,
  );
}

/**
 * Run the device-code round trip.
 *
 * Exported so `init --device-auth` reuses the identical handshake instead of
 * growing a second copy of the polling state machine.
 */
export async function performDeviceAuthLogin(input: {
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
}> {
  assertCredentialStoreUsable();

  const start = await startDeviceAuthorization({
    apiUrl: input.apiUrl,
    flow: input.flow ?? 'login',
    ...(input.projectName ? { projectName: input.projectName } : {}),
    ...(input.osType ? { osType: input.osType } : {}),
    ...(input.machineId ? { machineId: input.machineId } : {}),
    ...(input.authPathEnc ? { authPathEnc: input.authPathEnc } : {}),
  });

  // The server owns this URL. Rebuilding it from AUTH_BASE_URL would send a
  // dev-API login to the production web app (and vice versa). The device code
  // itself is never printed — only the short code the user has to read out.
  console.log('🔐 On any device with a browser, open:');
  console.log(`   ${start.verificationUri}`);
  console.log(`   and enter the code: ${start.userCode}`);
  console.log(`   (direct link: ${start.verificationUriComplete})`);

  const spinner = createSpinner('Waiting for approval... (Ctrl+C to cancel)');
  try {
    const result = await pollDeviceAuthorization({
      apiUrl: input.apiUrl,
      start,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    spinner?.succeed();

    const state = getPersonalTokenClient(input.apiUrl).state();
    return {
      verificationUri: start.verificationUri,
      identity: result.identity,
      setup: result.setup,
      persisted: state.persisted,
      storeBackend: state.storeBackend,
      storeReason: state.storeReason,
      ...(state.storeDetail === undefined ? {} : { storeDetail: state.storeDetail }),
    };
  } catch (error) {
    spinner?.fail();
    throw error;
  }
}

/**
 * Run the browser round trip and exchange the resulting code for tokens.
 *
 * Exported so `init --auth personal-token` reuses the identical flow rather than
 * growing a second copy of the PKCE handshake.
 */
export async function performPersonalTokenLogin(input: { apiUrl: string; projectName?: string }): Promise<{
  authUrl: string;
  identity: AuthLoginResult['identity'];
  persisted: boolean;
  storeBackend: CredentialBackendId;
  storeReason: CredentialStoreReason;
  storeDetail?: string;
}> {
  const client = getPersonalTokenClient(input.apiUrl);
  const pkce = createPkcePair();
  const authContext = await startAuthorizationCodeServer({ state: createAuthState() });

  const authUrl = buildPersonalTokenAuthorizeUrl({
    port: authContext.port,
    state: authContext.state,
    codeChallenge: pkce.challenge,
    ...(input.projectName ? { projectName: input.projectName } : {}),
  });

  await tryOpenBrowser(authUrl);
  const spinner = createSpinner('Waiting for authorization... (Ctrl+C to cancel)');

  try {
    const callback = await authContext.waitForCallback();
    spinner?.succeed();

    const session = await client.exchangeAuthorizationCode({
      code: callback.code,
      codeVerifier: pkce.verifier,
      // Must match the redirect the web registered the code against.
      redirectUri: `http://localhost:${authContext.port}/callback`,
    });

    const state = client.state();
    return {
      authUrl,
      identity: session.identity,
      persisted: state.persisted,
      storeBackend: state.storeBackend,
      storeReason: state.storeReason,
      ...(state.storeDetail === undefined ? {} : { storeDetail: state.storeDetail }),
    };
  } catch (error) {
    spinner?.fail();
    throw decorateLoopbackTimeout(error, DEVICE_AUTH_HINT);
  } finally {
    if (authContext.server.listening) {
      authContext.server.close();
    }
  }
}

/**
 * Attach the device-code hint to the loopback timeout.
 *
 * That timeout is exactly the failure this feature exists for: the browser
 * called back to *its own* localhost, so a login started over SSH waits 60
 * seconds and dies with no idea what to do next. The hint is added where the
 * user-facing message is built rather than inside `authServer`, so the local
 * (working) path keeps its message unchanged.
 */
export function decorateLoopbackTimeout(error: unknown, hint: string): unknown {
  if (error instanceof Error && error.message.startsWith('OAuth callback timed out')) {
    return new PersonalTokenError('TRANSIENT', `${error.message} ${hint}`);
  }
  return error;
}

async function login(options: Record<string, unknown>): Promise<AuthLoginResult> {
  const requestedApiUrl = typeof options.apiUrl === 'string' ? options.apiUrl : undefined;
  const apiUrl = resolveAuthApiUrl({ apiUrl: requestedApiUrl });
  // What every later command will resolve against. The refresh token is filed
  // under the server that issued it, so logging in to a different one would
  // store the credential in a slot nothing ever reads — a "success" that makes
  // the very next command fail.
  const projectApiUrl = resolveAuthApiUrl();

  if (apiUrl !== projectApiUrl) {
    throw new PersonalTokenError(
      'TRANSIENT',
      `This project talks to ${projectApiUrl}, so a login to ${apiUrl} would be stored where no command looks for it. ` +
        `Point the project at that server first (set apiUrl in .agentteams/config.json or AGENTTEAMS_API_URL), then run 'agentteams auth login' without --api-url.`,
    );
  }

  const useDeviceAuth = shouldUseDeviceAuth(options);
  const outcome = useDeviceAuth
    ? await performDeviceAuthLogin({ apiUrl })
    : await performPersonalTokenLogin({ apiUrl });
  const authUrl = 'authUrl' in outcome ? outcome.authUrl : outcome.verificationUri;

  // Only ever on an explicit --set-default. A login that silently made itself the
  // machine default would turn "just this once" into a permanent setting.
  const deviceAuthDefaultPath = useDeviceAuth && options.setDefault === true ? setDeviceAuthDefault(true) : null;

  const configPath = findProjectConfig(process.cwd());
  // Opting the project in is what makes later commands prefer this credential.
  // Only ever done for a credential that outlives this process: flipping the
  // project over to a login the next command cannot find would lock it out
  // entirely when there is no `key_` left to fall back to.
  const opted = configPath && outcome.persisted ? setProjectAuthMode(configPath, 'personal-token') : false;

  const result: AuthLoginResult = {
    success: true,
    authUrl,
    apiUrl,
    identity: outcome.identity,
    persisted: outcome.persisted,
    storeBackend: outcome.storeBackend,
    storeReason: outcome.storeReason,
    ...(outcome.storeDetail === undefined ? {} : { storeDetail: outcome.storeDetail }),
    configPath: opted ? configPath : null,
    authMode: 'personal-token',
    deviceAuth: useDeviceAuth,
  };

  if (deviceAuthDefaultPath) {
    result.deviceAuthDefaultPath = deviceAuthDefaultPath;
  }

  if (!outcome.persisted) {
    result.warning =
      'The login is kept in memory for this process only, so this project was left on its existing credential. ' +
      'For CI and headless machines, keep using an API key (AGENTTEAMS_API_KEY).';
  } else if (!opted) {
    result.warning =
      "No project config was found, so nothing was switched to the personal login. Run 'agentteams init' in the project first, then run this again.";
  }

  return result;
}

async function status(options: Record<string, unknown> = {}): Promise<AuthStatusResult> {
  const apiUrl = resolveAuthApiUrl({ apiUrl: typeof options.apiUrl === 'string' ? options.apiUrl : undefined });
  const projectConfig = loadProjectConfig();
  const client = getPersonalTokenClient(apiUrl);

  // Reading the state must not require a working network: a token that cannot
  // be refreshed right now is still worth reporting as present.
  const tokenState = client.state();

  let credentialSource: CredentialSource | null = null;
  let problem: string | undefined;
  try {
    // The same apiUrl this command reports, so `apiUrl` and `credentialSource`
    // can never describe two different servers.
    credentialSource = (await resolveCredential({ apiUrl }))?.source ?? null;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  const refreshedState = client.state();

  const result: AuthStatusResult = {
    apiUrl,
    configPath: findProjectConfig(process.cwd()),
    credentialSource,
    authMode: projectConfig?.authMode ?? null,
    hasProjectApiKey: typeof projectConfig?.apiKey === 'string' && projectConfig.apiKey.length > 0,
    deviceAuthDefault: {
      enabled: isDeviceAuthDefaultEnabled(),
      configPath: globalConfigPath(),
      disableHint: `Remove "deviceAuth" from ${globalConfigPath()} (and unset AGENTTEAMS_DEVICE_AUTH) to go back to the browser callback login.`,
    },
    personalToken: {
      connected: tokenState.connected,
      persisted: tokenState.persisted,
      storeBackend: tokenState.storeBackend,
      storeReason: tokenState.storeReason,
      ...(tokenState.storeDetail === undefined ? {} : { storeDetail: tokenState.storeDetail }),
      reconnectRequired: refreshedState.reconnectRequired,
      identity: refreshedState.identity,
      expiresAt: refreshedState.expiresAt ? new Date(refreshedState.expiresAt).toISOString() : null,
    },
  };

  if (problem) result.problem = problem;
  return result;
}

/**
 * Leave the personal-token path.
 *
 * Reverting `authMode` is the part that must always be reachable: a project
 * left on `personal-token` with no credential fails every command, so a missing
 * keychain entry or an unreachable server cannot be allowed to trap the user in
 * a state only a hand-edited config file gets out of.
 */
async function logout(options: Record<string, unknown> = {}): Promise<AuthLogoutResult> {
  const apiUrl = resolveAuthApiUrl({ apiUrl: typeof options.apiUrl === 'string' ? options.apiUrl : undefined });
  const client = getPersonalTokenClient(apiUrl);
  const localOnly = options.local === true;

  let revokedOnServer = false;
  let warning: string | undefined;

  if (!client.hasCredential()) {
    warning = `No AgentTeams login was stored for ${apiUrl}; only the project setting was reverted.`;
  } else if (localOnly) {
    client.forgetLocalCredential();
    warning =
      'The local credential was removed without contacting the server, so the token is still valid there. ' +
      'Revoke it from the AgentTeams web app if you no longer want it.';
  } else {
    try {
      // Server first: clearing locally and then failing the revoke would leave a
      // live refresh token the owner can no longer see or cancel.
      await client.revoke();
      revokedOnServer = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PersonalTokenError(
        'REVOKE_FAILED',
        `${detail} Run 'agentteams auth logout --local' to leave the personal login path anyway.`,
      );
    }
  }

  const configPath = findProjectConfig(process.cwd());
  const reverted = configPath ? setProjectAuthMode(configPath, null) : false;
  const projectConfig = loadProjectConfig();

  const result: AuthLogoutResult = {
    success: true,
    apiUrl,
    configPath: reverted ? configPath : null,
    revokedOnServer,
    fellBackToApiKey: typeof projectConfig?.apiKey === 'string' && projectConfig.apiKey.length > 0,
  };
  if (warning) result.warning = warning;
  return result;
}

export async function executeAuthCommand(action: string, options: Record<string, unknown> = {}): Promise<unknown> {
  return withCommandContext(`auth:${action}`, async () => {
    switch (action) {
      case 'login':
        return login(options);
      case 'status':
        return status(options);
      case 'logout':
        return logout(options);
      default:
        throw new Error(`Unknown action: ${action}. Expected one of: login, status, logout.`);
    }
  });
}
