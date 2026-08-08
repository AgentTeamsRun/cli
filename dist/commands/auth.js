/**
 * `agentteams auth login | status | logout`.
 *
 * The default authentication path for new projects and the migration path for
 * legacy configs. The stored credential is picked up by `resolveCredential()`
 * when the config has no `key_`, or when a migrated legacy project carries
 * `authMode: 'personal-token'`.
 */
import open from 'open';
import { getPersonalTokenClient, PersonalTokenError } from '../auth/personalTokenClient.js';
import { startAuthorizationCodeServer, createAuthState, createPkcePair } from '../utils/authServer.js';
import { DEFAULT_API_URL, findProjectConfig, loadProjectConfig, resolveCredential, setProjectAuthMode, } from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';
import { withCommandContext } from '../utils/commandContext.js';
const AUTH_BASE_URL = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';
/**
 * Where to log in. Unlike the legacy `init` path this honours the project's own
 * `apiUrl`, because a refresh token issued by the dev API is worthless against
 * production and storing it under the wrong server would silently fail later.
 */
export function resolveAuthApiUrl(options) {
    const candidate = (typeof options?.apiUrl === 'string' && options.apiUrl.length > 0 ? options.apiUrl : undefined) ??
        process.env.AGENTTEAMS_API_URL ??
        loadProjectConfig()?.apiUrl ??
        DEFAULT_API_URL;
    return candidate.replace(/\/+$/, '');
}
export function buildPersonalTokenAuthorizeUrl(input) {
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
function isSshEnvironment() {
    return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}
async function tryOpenBrowser(url) {
    console.log('🔐 Complete the AgentTeams login in your browser:');
    console.log(url);
    // Headless and SSH sessions have no browser to open; the printed URL is the
    // whole interface there, exactly as in `init`.
    if (isSshEnvironment()) {
        return;
    }
    try {
        await open(url);
    }
    catch {
        // Already printed.
    }
}
/**
 * Run the browser round trip and exchange the resulting code for tokens.
 *
 * Exported so `init --auth personal-token` reuses the identical flow rather than
 * growing a second copy of the PKCE handshake.
 */
export async function performPersonalTokenLogin(input) {
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
        };
    }
    catch (error) {
        spinner?.fail();
        throw error;
    }
    finally {
        if (authContext.server.listening) {
            authContext.server.close();
        }
    }
}
async function login(options) {
    const requestedApiUrl = typeof options.apiUrl === 'string' ? options.apiUrl : undefined;
    const apiUrl = resolveAuthApiUrl({ apiUrl: requestedApiUrl });
    // What every later command will resolve against. The refresh token is filed
    // under the server that issued it, so logging in to a different one would
    // store the credential in a slot nothing ever reads — a "success" that makes
    // the very next command fail.
    const projectApiUrl = resolveAuthApiUrl();
    if (apiUrl !== projectApiUrl) {
        throw new PersonalTokenError('TRANSIENT', `This project talks to ${projectApiUrl}, so a login to ${apiUrl} would be stored where no command looks for it. ` +
            `Point the project at that server first (set apiUrl in .agentteams/config.json or AGENTTEAMS_API_URL), then run 'agentteams auth login' without --api-url.`);
    }
    const outcome = await performPersonalTokenLogin({ apiUrl });
    const configPath = findProjectConfig(process.cwd());
    // Opting the project in is what makes later commands prefer this credential.
    // Only ever done for a credential that outlives this process: flipping the
    // project over to a login the next command cannot find would lock it out
    // entirely when there is no `key_` left to fall back to.
    const opted = configPath && outcome.persisted ? setProjectAuthMode(configPath, 'personal-token') : false;
    const result = {
        success: true,
        authUrl: outcome.authUrl,
        apiUrl,
        identity: outcome.identity,
        persisted: outcome.persisted,
        storeBackend: outcome.storeBackend,
        storeReason: outcome.storeReason,
        configPath: opted ? configPath : null,
        authMode: 'personal-token',
    };
    if (!outcome.persisted) {
        result.warning =
            'The login is kept in memory for this process only, so this project was left on its existing credential. ' +
                'For CI and headless machines, keep using an API key (AGENTTEAMS_API_KEY).';
    }
    else if (!opted) {
        result.warning =
            "No project config was found, so nothing was switched to the personal login. Run 'agentteams init' in the project first, then run this again.";
    }
    return result;
}
async function status(options = {}) {
    const apiUrl = resolveAuthApiUrl({ apiUrl: typeof options.apiUrl === 'string' ? options.apiUrl : undefined });
    const projectConfig = loadProjectConfig();
    const client = getPersonalTokenClient(apiUrl);
    // Reading the state must not require a working network: a token that cannot
    // be refreshed right now is still worth reporting as present.
    const tokenState = client.state();
    let credentialSource = null;
    let problem;
    try {
        // The same apiUrl this command reports, so `apiUrl` and `credentialSource`
        // can never describe two different servers.
        credentialSource = (await resolveCredential({ apiUrl }))?.source ?? null;
    }
    catch (error) {
        problem = error instanceof Error ? error.message : String(error);
    }
    const refreshedState = client.state();
    const result = {
        apiUrl,
        configPath: findProjectConfig(process.cwd()),
        credentialSource,
        authMode: projectConfig?.authMode ?? null,
        hasProjectApiKey: typeof projectConfig?.apiKey === 'string' && projectConfig.apiKey.length > 0,
        personalToken: {
            connected: tokenState.connected,
            persisted: tokenState.persisted,
            storeBackend: tokenState.storeBackend,
            storeReason: tokenState.storeReason,
            reconnectRequired: refreshedState.reconnectRequired,
            identity: refreshedState.identity,
            expiresAt: refreshedState.expiresAt ? new Date(refreshedState.expiresAt).toISOString() : null,
        },
    };
    if (problem)
        result.problem = problem;
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
async function logout(options = {}) {
    const apiUrl = resolveAuthApiUrl({ apiUrl: typeof options.apiUrl === 'string' ? options.apiUrl : undefined });
    const client = getPersonalTokenClient(apiUrl);
    const localOnly = options.local === true;
    let revokedOnServer = false;
    let warning;
    if (!client.hasCredential()) {
        warning = `No AgentTeams login was stored for ${apiUrl}; only the project setting was reverted.`;
    }
    else if (localOnly) {
        client.forgetLocalCredential();
        warning =
            'The local credential was removed without contacting the server, so the token is still valid there. ' +
                'Revoke it from the AgentTeams web app if you no longer want it.';
    }
    else {
        try {
            // Server first: clearing locally and then failing the revoke would leave a
            // live refresh token the owner can no longer see or cancel.
            await client.revoke();
            revokedOnServer = true;
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new PersonalTokenError('REVOKE_FAILED', `${detail} Run 'agentteams auth logout --local' to leave the personal login path anyway.`);
        }
    }
    const configPath = findProjectConfig(process.cwd());
    const reverted = configPath ? setProjectAuthMode(configPath, null) : false;
    const projectConfig = loadProjectConfig();
    const result = {
        success: true,
        apiUrl,
        configPath: reverted ? configPath : null,
        revokedOnServer,
        fellBackToApiKey: typeof projectConfig?.apiKey === 'string' && projectConfig.apiKey.length > 0,
    };
    if (warning)
        result.warning = warning;
    return result;
}
export async function executeAuthCommand(action, options = {}) {
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
//# sourceMappingURL=auth.js.map