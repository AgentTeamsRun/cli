import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
const CALLBACK_TIMEOUT_MS = 60_000;
const DEFAULT_WEB_URL = 'https://agentteams.run';
/** 24 random bytes → 32 base64url characters, comfortably above the 16-character floor. */
const AUTH_STATE_BYTES = 24;
// Only a web build older than this CLI omits the state, so a plain "try again"
// would loop the user forever. Say what is actually wrong and give the two exits
// that work: wait for the deploy, or install a CLI that matches the live web.
const WEB_UPDATE_HINT = 'The AgentTeams web page did not echo the login state, so it is older than this CLI. ' +
    'Hard-refresh /cli/authorize and retry; if it keeps failing, the web deploy has not caught up yet — ' +
    'retry in a few minutes or install a CLI version matching the deployed web.';
export const SETUP_METADATA_MISSING_HINT = 'The AgentTeams web page completed a plain login instead of the project setup this CLI asked for, so it is older than this CLI. ' +
    'Hard-refresh /cli/authorize and run `agentteams init` again; if it keeps failing, the web deploy has not caught up yet — ' +
    'retry in a few minutes, or install a CLI version matching the deployed web. ' +
    'Nothing was written to this project and the authorization code was discarded.';
/**
 * The same skew one deploy further back: the page answered with the legacy
 * agent-key callback. Unlike {@link SETUP_METADATA_MISSING_HINT} this one cannot
 * end with "nothing happened" — the key was already issued server-side and only
 * the user can revoke it.
 */
export const SETUP_LEGACY_AGENT_KEY_HINT = 'The AgentTeams web page answered with the old agent-key callback instead of the project setup this CLI asked for, so it is older than this CLI. ' +
    'Hard-refresh /cli/authorize and run `agentteams init` again; if it keeps failing, the web deploy has not caught up yet — ' +
    'retry in a few minutes, or install a CLI version matching the deployed web. ' +
    'Nothing was written to this project, but that page already issued an agent API key — revoke it in the web app (project settings → agents).';
export function isUnifiedSetupMetadataMissing(value) {
    return value.metadataMissing === true;
}
/** Unguessable value that proves a callback belongs to the login this process started. */
export function createAuthState() {
    return randomBytes(AUTH_STATE_BYTES).toString('base64url');
}
/**
 * PKCE S256 pair.
 *
 * 48 random bytes base64url-encode to 64 characters, inside the server's
 * 43–128 range (`api/src/routes/desktop-auth/index.ts`).
 */
export function createPkcePair() {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
function isAuthorizationCodeResult(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return typeof candidate.code === 'string' && candidate.code.length > 0;
}
function listenOnEphemeralPort(server) {
    return new Promise((resolve, reject) => {
        const onListening = () => {
            server.removeListener('error', onError);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('The local OAuth callback server did not report a TCP port.'));
                return;
            }
            resolve(address.port);
        };
        const onError = (error) => {
            server.removeListener('listening', onListening);
            reject(error);
        };
        server.once('listening', onListening);
        server.once('error', onError);
        // Port 0 asks the OS for a free port: nothing for another local process to
        // squat on ahead of time, and no fixed range to exhaust.
        server.listen(0, 'localhost');
    });
}
function isAuthResult(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    const seedPlanIdValid = candidate.seedPlanId === undefined || candidate.seedPlanId === null || typeof candidate.seedPlanId === 'string';
    return (typeof candidate.teamId === 'string' &&
        typeof candidate.projectId === 'string' &&
        typeof candidate.agentName === 'string' &&
        typeof candidate.apiKey === 'string' &&
        typeof candidate.configId === 'string' &&
        seedPlanIdValid);
}
/**
 * Copy only the fields the CLI trusts. Anything else in the payload — notably an
 * `apiUrl` pointing every later request at an attacker's server — is dropped here.
 */
function toAuthResult(payload) {
    const result = {
        teamId: payload.teamId,
        projectId: payload.projectId,
        agentName: payload.agentName,
        apiKey: payload.apiKey,
        configId: payload.configId,
    };
    if (payload.seedPlanId !== undefined) {
        result.seedPlanId = payload.seedPlanId;
    }
    return result;
}
function statesMatch(expected, received) {
    const expectedBytes = Buffer.from(expected, 'utf-8');
    const receivedBytes = Buffer.from(received, 'utf-8');
    if (expectedBytes.length !== receivedBytes.length) {
        return false;
    }
    return timingSafeEqual(expectedBytes, receivedBytes);
}
function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        request.on('error', reject);
    });
}
function normalizeOrigin(value) {
    try {
        return new URL(value).origin;
    }
    catch {
        return null;
    }
}
/**
 * Only the configured web origin may post a callback. There is deliberately no
 * blanket `http://localhost:*` allowance: any page served from any local port
 * used to qualify. Local development and the dev environment opt in explicitly
 * instead, through `AGENTTEAMS_WEB_URL` or `AGENTTEAMS_OAUTH_ALLOWED_ORIGINS`.
 */
function getAllowedOrigins() {
    const origins = new Set();
    const webOrigin = normalizeOrigin(process.env.AGENTTEAMS_WEB_URL || DEFAULT_WEB_URL);
    if (webOrigin) {
        origins.add(webOrigin);
    }
    for (const entry of (process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS ?? '').split(',')) {
        const trimmed = entry.trim();
        if (trimmed.length === 0) {
            continue;
        }
        const origin = normalizeOrigin(trimmed);
        if (origin) {
            origins.add(origin);
        }
    }
    return Array.from(origins.values());
}
function isAllowedOrigin(origin) {
    if (!origin) {
        return false;
    }
    return getAllowedOrigins().includes(origin);
}
function setCorsHeaders(response, request) {
    const origin = request?.headers.origin;
    if (isAllowedOrigin(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJson(response, statusCode, payload, request) {
    const body = JSON.stringify(payload);
    setCorsHeaders(response, request);
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
}
/**
 * The hardened loopback callback server, shared by both login paths.
 *
 * Origin allow-listing, constant-time state comparison, the ephemeral port, and
 * the "a forged callback must not consume this login" rule all live here once:
 * the authorization-code path must not get a second, weaker copy of them. The
 * only difference between the two callers is which payload shape they accept.
 */
async function startCallbackServer(parsePayload, options) {
    const expectedState = options?.state ?? createAuthState();
    let settled = false;
    let timeoutHandle = null;
    let isWaiting = false;
    let resolveCallback;
    let rejectCallback;
    const callbackPromise = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });
    const stopServer = () => {
        if (!server.listening) {
            return;
        }
        server.close();
    };
    const clearTimeoutHandle = () => {
        if (!timeoutHandle) {
            return;
        }
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    };
    const resolveAuth = (payload) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeoutHandle();
        resolveCallback?.(payload);
        stopServer();
    };
    const rejectAuth = (error) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeoutHandle();
        rejectCallback?.(error);
        stopServer();
    };
    const server = createServer(async (request, response) => {
        if (request.method === 'OPTIONS') {
            setCorsHeaders(response, request);
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== 'POST' || request.url !== '/callback') {
            sendJson(response, 404, { message: 'Not found.' }, request);
            return;
        }
        // CORS headers only tell a browser what to do with a response; the body was
        // accepted long before that. Refuse the request itself instead.
        if (!isAllowedOrigin(request.headers.origin)) {
            sendJson(response, 403, { message: 'OAuth callback origin is not allowed.' }, request);
            return;
        }
        if (settled) {
            sendJson(response, 409, { message: 'OAuth callback already processed.' }, request);
            return;
        }
        try {
            const rawBody = await readRequestBody(request);
            const rawPayload = JSON.parse(rawBody);
            const payload = parsePayload(rawPayload);
            if (!payload) {
                sendJson(response, 400, { message: 'Invalid OAuth callback payload.' }, request);
                return;
            }
            // The state is read from the raw body, not from the parsed result: the
            // legacy parser strips every field the CLI does not trust, `state`
            // included, and it must still be checked before anything is accepted.
            const receivedState = rawPayload.state;
            if (typeof receivedState !== 'string' || receivedState.length === 0) {
                sendJson(response, 400, { message: `Missing OAuth callback state. ${WEB_UPDATE_HINT}` }, request);
                return;
            }
            // A mismatch must not consume `settled`: the login this process started is
            // still outstanding, and burning it here would hand a forged callback a
            // trivial denial of service.
            if (!statesMatch(expectedState, receivedState)) {
                sendJson(response, 400, { message: 'OAuth callback state does not match this login.' }, request);
                return;
            }
            sendJson(response, 200, { success: true }, request);
            setTimeout(() => {
                resolveAuth(payload);
            }, 100);
        }
        catch {
            sendJson(response, 400, { message: 'Invalid JSON body.' }, request);
        }
    });
    const port = await listenOnEphemeralPort(server);
    server.on('error', (error) => {
        rejectAuth(new Error(`OAuth callback server failed: ${error.message}`));
    });
    server.once('close', () => {
        if (!settled && isWaiting) {
            rejectAuth(new Error('OAuth callback server closed before receiving callback.'));
            return;
        }
        if (!settled) {
            settled = true;
            clearTimeoutHandle();
        }
    });
    const waitForCallback = () => {
        if (!isWaiting) {
            isWaiting = true;
            timeoutHandle = setTimeout(() => {
                rejectAuth(new Error('OAuth callback timed out after 60 seconds.'));
            }, CALLBACK_TIMEOUT_MS);
        }
        return callbackPromise;
    };
    return {
        server,
        waitForCallback,
        port,
        state: expectedState,
    };
}
/**
 * Legacy login callback: the web posts the issued agent key back to this port.
 * Kept unchanged for CLI/web combinations that predate the authorization-code
 * path; `P3` is where it goes away.
 */
export function startLocalAuthServer(options) {
    return startCallbackServer((value) => (isAuthResult(value) ? toAuthResult(value) : null), options);
}
/** Authorization-code login callback: only `{ code, state }` crosses this boundary. */
export function startAuthorizationCodeServer(options) {
    return startCallbackServer((value) => (isAuthorizationCodeResult(value) ? { code: value.code, state: value.state } : null), options);
}
function readNonEmptyString(candidate, key) {
    const value = candidate[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}
/**
 * The legacy `{ teamId, projectId, agentName, apiKey, configId }` callback,
 * recognised only to fail fast. `apiKey` is the field that matters: it is both
 * what makes the body unmistakably the old shape and the thing the user is told
 * to revoke. Nothing here is ever copied into a result.
 */
function isLegacyAgentKeyCallback(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return Boolean(readNonEmptyString(candidate, 'apiKey') &&
        readNonEmptyString(candidate, 'configId') &&
        readNonEmptyString(candidate, 'teamId'));
}
/**
 * Copy only the fields the CLI trusts, exactly as {@link toAuthResult} does.
 *
 * Returning `null` means "this is not a callback for this login at all";
 * returning the metadata-missing marker means "it is, but from a web build that
 * cannot complete the setup" — the two need different answers upstream.
 */
export function parseUnifiedSetupPayload(value) {
    if (!isAuthorizationCodeResult(value)) {
        // A web build that predates the authorization code ignores `flow=setup`
        // outright and posts the legacy agent-key body. Answering `null` there would
        // leave the callback unsettled — the CLI would sit through the full 60-second
        // timeout and report it as a timeout, with no word about the key that page
        // just minted. Classify it instead so the failure is immediate and named.
        return isLegacyAgentKeyCallback(value) ? { metadataMissing: true, legacyAgentKeyIssued: true } : null;
    }
    const candidate = value;
    const teamId = readNonEmptyString(candidate, 'teamId');
    const projectId = readNonEmptyString(candidate, 'projectId');
    const configId = readNonEmptyString(candidate, 'configId');
    const agentName = readNonEmptyString(candidate, 'agentName');
    if (!teamId || !projectId || !configId || !agentName) {
        return { metadataMissing: true };
    }
    const result = {
        code: candidate.code,
        state: typeof candidate.state === 'string' ? candidate.state : '',
        teamId,
        projectId,
        configId,
        agentName,
    };
    if (candidate.seedPlanId === null || typeof candidate.seedPlanId === 'string') {
        result.seedPlanId = candidate.seedPlanId;
    }
    return result;
}
/** Unified setup callback: an authorization code plus the connection identifiers. */
export function startUnifiedSetupServer(options) {
    return startCallbackServer(parseUnifiedSetupPayload, options);
}
//# sourceMappingURL=authServer.js.map