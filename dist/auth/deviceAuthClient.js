/**
 * RFC 8628 device authorization for the CLI.
 *
 * The point of this flow is that **no local port is opened**. The terminal shows a
 * short code, the user approves it in a browser on any other machine, and this
 * module polls the server until that happens. It is only ever entered through the
 * explicit `--device-auth` flag (or the machine-wide default the user declared);
 * nothing here inspects SSH/container/WSL state to choose a flow.
 */
import { CLI_OAUTH_CLIENT_ID, getPersonalTokenClient, PersonalTokenError, } from './personalTokenClient.js';
/** Fallback poll interval when the server does not send one. The server value always wins. */
const FALLBACK_INTERVAL_SECONDS = 5;
/** RFC 8628 `slow_down` step, used only when the server does not name the new interval. */
const SLOW_DOWN_STEP_SECONDS = 5;
/** Consecutive network failures tolerated before giving up. */
const MAX_TRANSIENT_FAILURES = 5;
const START_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Ask the server to open a device session.
 *
 * The two failure shapes are kept distinct on purpose. A 404 means the server is
 * too old to know this endpoint — the fix is to re-run *without* the flag. A 503
 * means the server knows it but is not configured for it — re-running without the
 * flag also works, but the operator has something to fix. Collapsing them into one
 * message sends half the users after the wrong problem.
 */
export async function startDeviceAuthorization(input) {
    const doFetch = input.fetchImpl ?? globalThis.fetch;
    const baseUrl = input.apiUrl.replace(/\/+$/, '');
    let response;
    try {
        response = await doFetch(`${baseUrl}/api/auth/desktop/device/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLI_OAUTH_CLIENT_ID,
                flow: input.flow,
                ...(input.projectName ? { projectName: input.projectName } : {}),
                ...(input.osType ? { osType: input.osType } : {}),
                ...(input.machineId ? { machineId: input.machineId } : {}),
                ...(input.authPathEnc ? { authPathEnc: input.authPathEnc } : {}),
            }),
            signal: AbortSignal.timeout(START_REQUEST_TIMEOUT_MS),
        });
    }
    catch (error) {
        throw new PersonalTokenError('TRANSIENT', `Could not reach ${baseUrl} to start device authorization: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (response.status === 404) {
        throw new PersonalTokenError('TRANSIENT', `${baseUrl} does not support device authorization (it is running an older AgentTeams API). ` +
            'Run the same command without --device-auth to use the browser callback login.');
    }
    if (response.status === 503) {
        throw new PersonalTokenError('TRANSIENT', `${baseUrl} has device authorization turned off because the server has no APP_URL configured. ` +
            'Ask the server operator to set APP_URL, or run the same command without --device-auth for now.');
    }
    if (!response.ok) {
        throw new PersonalTokenError('TRANSIENT', `Device authorization could not be started (HTTP ${response.status}).`);
    }
    const body = (await response.json().catch(() => null));
    const data = body?.data;
    if (!data ||
        typeof data.deviceCode !== 'string' ||
        typeof data.userCode !== 'string' ||
        typeof data.verificationUri !== 'string') {
        throw new PersonalTokenError('MALFORMED_RESPONSE', 'The server returned an unexpected device authorization payload.');
    }
    return {
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        verificationUriComplete: typeof data.verificationUriComplete === 'string' ? data.verificationUriComplete : data.verificationUri,
        expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 900,
        interval: typeof data.interval === 'number' && data.interval > 0 ? data.interval : FALLBACK_INTERVAL_SECONDS,
    };
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Poll until the session is approved, denied, or expires.
 *
 * Interval discipline is the whole job: the server's `interval` is honoured as
 * given, `slow_down` raises it, and the loop also stops locally at `expiresIn` so
 * a server that never answers cannot turn into an unbounded poll.
 */
export async function pollDeviceAuthorization(input) {
    const client = getPersonalTokenClient(input.apiUrl);
    const sleep = input.sleep ?? defaultSleep;
    const now = input.now ?? Date.now;
    const deadline = now() + input.start.expiresIn * 1000;
    let intervalSeconds = input.start.interval;
    let transientFailures = 0;
    while (true) {
        if (input.signal?.aborted) {
            throw new PersonalTokenError('TRANSIENT', 'Device authorization was cancelled.');
        }
        await sleep(intervalSeconds * 1000);
        if (input.signal?.aborted) {
            throw new PersonalTokenError('TRANSIENT', 'Device authorization was cancelled.');
        }
        if (now() >= deadline) {
            throw new PersonalTokenError('INVALID_GRANT', 'The device code expired before it was approved. Run the command again to get a new code.');
        }
        const outcome = await client.pollDeviceToken(input.start.deviceCode);
        switch (outcome.kind) {
            case 'approved':
                return { identity: outcome.session.identity, setup: outcome.setup };
            case 'pending':
                transientFailures = 0;
                break;
            case 'slowDown':
                transientFailures = 0;
                intervalSeconds = outcome.intervalSeconds ?? intervalSeconds + SLOW_DOWN_STEP_SECONDS;
                break;
            case 'denied':
                throw new PersonalTokenError('INVALID_GRANT', 'The sign-in request was denied in the browser.');
            case 'expired':
                throw new PersonalTokenError('INVALID_GRANT', 'The device code expired before it was approved. Run the command again to get a new code.');
            case 'invalid':
                throw new PersonalTokenError('INVALID_GRANT', 'The device code is no longer valid. Run the command again to get a new code.');
            case 'transient':
                // Back off but keep going: the user may still be finishing the approval.
                transientFailures += 1;
                if (transientFailures >= MAX_TRANSIENT_FAILURES) {
                    throw new PersonalTokenError('TRANSIENT', `Lost contact with ${input.apiUrl} while waiting for approval: ${outcome.detail}.`);
                }
                intervalSeconds += SLOW_DOWN_STEP_SECONDS;
                break;
        }
    }
}
//# sourceMappingURL=deviceAuthClient.js.map