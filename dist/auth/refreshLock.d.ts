/**
 * Cross-process mutex for refresh-token rotation.
 *
 * Rotation is destructive on the server: presenting a refresh token that has
 * already been rotated is reuse, and the server answers reuse by revoking the
 * **entire token family** (`rotatePersonalRefreshToken` in
 * `api/src/services/personalToken.ts`). Every `agentteams` invocation rotates,
 * and several can run at once — one-shot commands next to a long-lived
 * `agentteams mcp` server. Without serialization, two processes reading the same
 * token and rotating it concurrently log the user out of every process at once,
 * recoverable only by a fresh `agentteams auth login`.
 *
 * The lock is a file created with `wx`, which is atomic on every platform the
 * CLI supports, so no native dependency is needed. Two failure modes are
 * deliberately not treated as errors:
 *
 *  - **No usable lock directory** (read-only home, sandbox) → run unlocked.
 *    The lock protects against a race; refusing to authenticate at all because
 *    the guard is unavailable would be the worse outcome.
 *  - **A lock left behind by a crashed process** → broken once it is older than
 *    {@link DEFAULT_STALE_AFTER_MS}, so a killed process cannot lock the user
 *    out permanently.
 *
 * Contention that outlives the timeout raises {@link RefreshLockTimeoutError}
 * instead of rotating anyway: the caller treats it like a network failure and
 * keeps the credential, which costs one retry. Rotating unlocked would risk the
 * family revocation this module exists to prevent.
 */
/**
 * How long a held lock stays credible. A token request that has not finished by
 * then is either hung or its process is gone; both justify taking over.
 */
export declare const DEFAULT_STALE_AFTER_MS = 20000;
/** Long enough to outlast a slow-but-real rotation ahead of us in the queue. */
export declare const DEFAULT_TIMEOUT_MS = 30000;
export interface RefreshLock {
    withLock<T>(run: () => Promise<T>): Promise<T>;
}
export declare class RefreshLockTimeoutError extends Error {
    readonly lockPath: string;
    readonly timeoutMs: number;
    constructor(lockPath: string, timeoutMs: number);
}
/**
 * The lock file itself could not be maintained — distinct from losing a race for
 * it. Kept separate so the caller can say which one happened instead of
 * reporting every lock problem as a network failure.
 */
export declare class RefreshLockUnavailableError extends Error {
    readonly lockPath: string;
    readonly cause: unknown;
    constructor(lockPath: string, cause: unknown);
}
/**
 * A lock that never blocks. The default for {@link PersonalTokenClient} so unit
 * tests touch no filesystem; production wiring passes a real lock.
 */
export declare const noopRefreshLock: RefreshLock;
export interface CreateFileRefreshLockOptions {
    /** Defaults to `~/.agentteams/locks`. */
    directory?: string;
    staleAfterMs?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * One lock file per credential slot, named by {@link credentialSlotHash}.
 *
 * The name is a published on-disk contract: a running process holds this exact
 * path, so renaming it would make an older CLI and a newer one lock different
 * files and rotate the same refresh token concurrently.
 */
export declare function refreshLockFileName(slot: string): string;
export declare function createFileRefreshLock(slot: string, options?: CreateFileRefreshLockOptions): RefreshLock;
//# sourceMappingURL=refreshLock.d.ts.map