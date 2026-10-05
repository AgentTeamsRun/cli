/**
 * RFC 8628 device authorization for the CLI.
 *
 * The point of this flow is that **no local port is opened**. The terminal shows a
 * short code, the user approves it in a browser on any other machine, and this
 * module polls the server until that happens. It is only ever entered through the
 * explicit `--device-auth` flag (or the machine-wide default the user declared);
 * nothing here inspects SSH/container/WSL state to choose a flow.
 */
import { type DeviceSetupResult, type PersonalTokenIdentity } from './personalTokenClient.js';
export type DeviceAuthFlow = 'login' | 'setup';
export interface DeviceAuthorizationStart {
    deviceCode: string;
    /** Display form (`XXXX-XXXX`). Shown to the user; never used as a credential. */
    userCode: string;
    /** Server-owned. Never rebuilt from the CLI's own web URL — dev/prod must not cross. */
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
}
export interface DeviceAuthStartInput {
    apiUrl: string;
    flow: DeviceAuthFlow;
    projectName?: string;
    osType?: string;
    machineId?: string;
    /** Encrypted working directory; `init` sends it so path-based runner binding matches loopback. */
    authPathEnc?: string;
    fetchImpl?: typeof fetch;
}
/**
 * Ask the server to open a device session.
 *
 * The two failure shapes are kept distinct on purpose. A 404 means the server is
 * too old to know this endpoint — the fix is to re-run *without* the flag. A 503
 * means the server knows it but is not configured for it — re-running without the
 * flag also works, but the operator has something to fix. Collapsing them into one
 * message sends half the users after the wrong problem.
 */
export declare function startDeviceAuthorization(input: DeviceAuthStartInput): Promise<DeviceAuthorizationStart>;
export interface DeviceAuthPollInput {
    apiUrl: string;
    start: DeviceAuthorizationStart;
    /** Ctrl+C. Aborting stops the loop immediately rather than after the current sleep. */
    signal?: AbortSignal;
    /** Injected in tests so fake timers drive the interval instead of real waiting. */
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}
export interface DeviceAuthResult {
    identity: PersonalTokenIdentity;
    setup: DeviceSetupResult | null;
}
/**
 * Poll until the session is approved, denied, or expires.
 *
 * Interval discipline is the whole job: the server's `interval` is honoured as
 * given, `slow_down` raises it, and the loop also stops locally at `expiresIn` so
 * a server that never answers cannot turn into an unbounded poll.
 */
export declare function pollDeviceAuthorization(input: DeviceAuthPollInput): Promise<DeviceAuthResult>;
//# sourceMappingURL=deviceAuthClient.d.ts.map