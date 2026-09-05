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
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialSlotHash } from './slotHash.js';
/** Same `.agentteams` directory the global config lives in. */
const LOCK_DIR = ['.agentteams', 'locks'];
/**
 * How long a held lock stays credible. A token request that has not finished by
 * then is either hung or its process is gone; both justify taking over.
 */
export const DEFAULT_STALE_AFTER_MS = 20_000;
/** Long enough to outlast a slow-but-real rotation ahead of us in the queue. */
export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
export class RefreshLockTimeoutError extends Error {
    lockPath;
    timeoutMs;
    constructor(lockPath, timeoutMs) {
        super(`Timed out after ${timeoutMs}ms waiting for the credential rotation lock at ${lockPath}.`);
        this.lockPath = lockPath;
        this.timeoutMs = timeoutMs;
        this.name = 'RefreshLockTimeoutError';
    }
}
/**
 * The lock file itself could not be maintained — distinct from losing a race for
 * it. Kept separate so the caller can say which one happened instead of
 * reporting every lock problem as a network failure.
 */
export class RefreshLockUnavailableError extends Error {
    lockPath;
    cause;
    constructor(lockPath, cause) {
        super(`Could not maintain the credential rotation lock at ${lockPath}: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.lockPath = lockPath;
        this.cause = cause;
        this.name = 'RefreshLockUnavailableError';
    }
}
/**
 * A lock that never blocks. The default for {@link PersonalTokenClient} so unit
 * tests touch no filesystem; production wiring passes a real lock.
 */
export const noopRefreshLock = {
    withLock: (run) => run(),
};
/**
 * One lock file per credential slot, named by {@link credentialSlotHash}.
 *
 * The name is a published on-disk contract: a running process holds this exact
 * path, so renaming it would make an older CLI and a newer one lock different
 * files and rotate the same refresh token concurrently.
 */
export function refreshLockFileName(slot) {
    return `personal-token-${credentialSlotHash(slot)}.lock`;
}
function isAlreadyExists(error) {
    return error?.code === 'EEXIST';
}
export function createFileRefreshLock(slot, options = {}) {
    const directory = options.directory ?? join(homedir(), ...LOCK_DIR);
    const lockPath = join(directory, refreshLockFileName(slot));
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    /**
     * When the lock was taken, or null if that cannot be established.
     *
     * The timestamp inside the file is preferred so the clock the caller injects is
     * the one that decides. An unreadable or half-written file falls back to mtime
     * rather than counting as "no holder": the file existing is itself evidence
     * that someone created it, and treating it as free would delete a live lock.
     */
    const readHeldSince = () => {
        try {
            const record = JSON.parse(readFileSync(lockPath, 'utf-8'));
            if (typeof record.startedAt === 'number')
                return record.startedAt;
        }
        catch {
            // Gone, or content we cannot interpret. mtime is the fallback below.
        }
        try {
            return statSync(lockPath).mtimeMs;
        }
        catch {
            // Really gone — the holder released between the two calls.
            return null;
        }
    };
    const breakIfStale = () => {
        const heldSince = readHeldSince();
        if (heldSince !== null && now() - heldSince < staleAfterMs) {
            return;
        }
        try {
            unlinkSync(lockPath);
        }
        catch {
            // Another waiter won the race to break it. Either way it is gone.
        }
    };
    /**
     * Publish the lock file with its content already in place.
     *
     * `writeFileSync` with `wx` creates the file and writes afterwards, leaving a
     * window in which the lock exists but is empty — long enough for a waiter to
     * read nothing, conclude there is no holder, and delete a lock that was just
     * taken. Writing to a private path and `link`ing it into place closes that
     * window: `link` is atomic and fails with EEXIST when the target exists, which
     * is the same mutual exclusion `wx` provides.
     */
    const publishLockFile = (owner, record) => {
        const stagingPath = `${lockPath}.${process.pid}.${randomUUID()}`;
        writeFileSync(stagingPath, JSON.stringify(record), { flag: 'wx', mode: FILE_MODE });
        try {
            linkSync(stagingPath, lockPath);
        }
        finally {
            try {
                unlinkSync(stagingPath);
            }
            catch {
                // The link either succeeded (the content lives on at lockPath) or threw
                // and is being propagated; either way the staging copy is disposable.
            }
        }
    };
    /** Returns the owner token, or null when this machine cannot host a lock. */
    const acquire = async () => {
        try {
            // `recursive` makes an existing directory a no-op, so anything thrown here
            // means no lock is possible at all (read-only home, no permission, a file
            // sitting on the path). Proceed unguarded rather than block every command.
            mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
        }
        catch {
            return null;
        }
        const deadline = now() + timeoutMs;
        let firstWriteError;
        for (;;) {
            const owner = `${process.pid}:${randomUUID()}`;
            const record = { owner, startedAt: now() };
            try {
                publishLockFile(owner, record);
                return owner;
            }
            catch (error) {
                if (!isAlreadyExists(error)) {
                    // Not contention. A transient failure (ENOSPC, a permission change
                    // mid-run) must not silently downgrade to an unguarded rotation, so it
                    // is retried within the same deadline and only reported if it persists.
                    firstWriteError ??= error;
                    if (now() >= deadline) {
                        throw new RefreshLockUnavailableError(lockPath, firstWriteError);
                    }
                    await sleep(retryDelayMs);
                    continue;
                }
            }
            breakIfStale();
            if (now() >= deadline) {
                throw new RefreshLockTimeoutError(lockPath, timeoutMs);
            }
            await sleep(retryDelayMs);
        }
    };
    const release = (owner) => {
        if (owner === null)
            return;
        try {
            // Only remove a lock still recorded as ours: if it was broken as stale
            // while we ran, the file now belongs to whoever took over.
            const record = JSON.parse(readFileSync(lockPath, 'utf-8'));
            if (record.owner !== owner)
                return;
            unlinkSync(lockPath);
        }
        catch {
            // Already gone, or unreadable. Nothing left to release.
        }
    };
    return {
        async withLock(run) {
            const owner = await acquire();
            try {
                return await run();
            }
            finally {
                release(owner);
            }
        },
    };
}
//# sourceMappingURL=refreshLock.js.map