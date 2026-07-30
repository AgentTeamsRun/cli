import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createFileRefreshLock,
  noopRefreshLock,
  refreshLockFileName,
  RefreshLockTimeoutError,
} from '../src/auth/refreshLock.js';

const SLOT = 'personal-refresh:https://api.agentteams.run';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'agentteams-refresh-lock-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const lockPath = () => join(directory, refreshLockFileName(SLOT));

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A clock the retry loop drives forward itself: `sleep` advances it instead of
 * waiting, so a contention test reaches its timeout without real timers.
 */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    start,
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe('refreshLock file naming', () => {
  it('turns a slot into a portable filename', () => {
    // A slot embeds an API URL, whose `:` and `/` are not filename-safe.
    expect(refreshLockFileName(SLOT)).toMatch(/^personal-token-[0-9a-f]{16}\.lock$/);
  });

  it('gives each API server its own lock', () => {
    expect(refreshLockFileName(SLOT)).not.toBe(refreshLockFileName('personal-refresh:https://dev-api.agentteams.run'));
  });
});

describe('refreshLock mutual exclusion', () => {
  it('runs a second holder only after the first releases', async () => {
    const lock = createFileRefreshLock(SLOT, { directory, retryDelayMs: 1 });
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = lock.withLock(async () => {
      order.push('first:enter');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:exit');
    });

    await tick();
    const second = lock.withLock(async () => {
      order.push('second:enter');
    });

    // The first holder still has it, so the second cannot have entered yet.
    await tick();
    expect(order).toEqual(['first:enter']);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:enter', 'first:exit', 'second:enter']);
  });

  it('leaves no lock file behind after a normal release', async () => {
    const lock = createFileRefreshLock(SLOT, { directory });

    await lock.withLock(async () => {
      expect(existsSync(lockPath())).toBe(true);
    });

    expect(existsSync(lockPath())).toBe(false);
  });

  it('releases the lock when the guarded work throws', async () => {
    const lock = createFileRefreshLock(SLOT, { directory });

    await expect(
      lock.withLock(async () => {
        throw new Error('rotation exploded');
      }),
    ).rejects.toThrow('rotation exploded');

    // Otherwise one failed rotation would block every later one until it went stale.
    expect(existsSync(lockPath())).toBe(false);
    await expect(lock.withLock(async () => 'second turn')).resolves.toBe('second turn');
  });

  it('returns the guarded work’s value', async () => {
    const lock = createFileRefreshLock(SLOT, { directory });

    await expect(lock.withLock(async () => 'atp_rotated')).resolves.toBe('atp_rotated');
  });
});

describe('refreshLock recovery', () => {
  it('breaks a lock left behind by a dead process', async () => {
    const now = 1_000_000;
    const lock = createFileRefreshLock(SLOT, { directory, staleAfterMs: 20_000, retryDelayMs: 1, now: () => now });
    // A crashed holder cannot release, so the file has to expire on its own.
    writeFileSync(lockPath(), JSON.stringify({ owner: '999999:dead', startedAt: now - 20_001 }));

    await expect(lock.withLock(async () => 'took over')).resolves.toBe('took over');
    expect(existsSync(lockPath())).toBe(false);
  });

  it('respects a lock that is held but not yet stale', async () => {
    const clock = fakeClock();
    const lock = createFileRefreshLock(SLOT, {
      directory,
      staleAfterMs: 20_000,
      timeoutMs: 100,
      retryDelayMs: 10,
      now: clock.now,
      sleep: clock.sleep,
    });
    // Still inside the stale window for the whole 100ms wait, so breaking it
    // would be stealing the lock from a process that is mid-rotation.
    writeFileSync(lockPath(), JSON.stringify({ owner: '999999:alive', startedAt: clock.start - 5_000 }));

    await expect(lock.withLock(async () => 'should not run')).rejects.toBeInstanceOf(RefreshLockTimeoutError);
    // The live holder's file survives the failed attempt.
    expect(JSON.parse(readFileSync(lockPath(), 'utf-8')).owner).toBe('999999:alive');
  });

  /**
   * A lock file whose content cannot be read still proves somebody created it.
   * Treating it as free is what let a waiter delete a lock that had just been
   * taken — the file exists before its content does — so age decides instead, and
   * mtime stands in when the timestamp inside is unavailable.
   */
  it('respects a freshly created lock file it cannot parse', async () => {
    const lock = createFileRefreshLock(SLOT, { directory, timeoutMs: 150, retryDelayMs: 10 });
    writeFileSync(lockPath(), '{not json');

    await expect(lock.withLock(async () => 'should not run')).rejects.toBeInstanceOf(RefreshLockTimeoutError);
    expect(existsSync(lockPath())).toBe(true);
  });

  it('respects an empty lock file, the state a create is momentarily in', async () => {
    const lock = createFileRefreshLock(SLOT, { directory, timeoutMs: 150, retryDelayMs: 10 });
    writeFileSync(lockPath(), '');

    await expect(lock.withLock(async () => 'should not run')).rejects.toBeInstanceOf(RefreshLockTimeoutError);
    expect(existsSync(lockPath())).toBe(true);
  });

  it('breaks an unparseable lock file once it is older than the stale window', async () => {
    const lock = createFileRefreshLock(SLOT, { directory, staleAfterMs: 1_000, retryDelayMs: 1 });
    // Killed mid-create long ago: unreadable *and* old, so it must not block forever.
    writeFileSync(lockPath(), '{not json');
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(lockPath(), longAgo, longAgo);

    await expect(lock.withLock(async () => 'took over')).resolves.toBe('took over');
  });

  it('publishes the lock with its content already in place and leaves no staging file', async () => {
    const lock = createFileRefreshLock(SLOT, { directory });

    await lock.withLock(async () => {
      // Never observable as empty: the content is written elsewhere and linked in.
      expect(JSON.parse(readFileSync(lockPath(), 'utf-8')).owner).toContain(`${process.pid}:`);
    });

    expect(readdirSync(directory)).toEqual([]);
  });

  it('does not delete a lock that was broken and re-taken while it ran', async () => {
    const now = 1_000_000;
    const lock = createFileRefreshLock(SLOT, { directory, staleAfterMs: 20_000, retryDelayMs: 1, now: () => now });

    await lock.withLock(async () => {
      // Simulate a waiter that judged us stale and took over.
      writeFileSync(lockPath(), JSON.stringify({ owner: '999999:successor', startedAt: now }));
    });

    expect(JSON.parse(readFileSync(lockPath(), 'utf-8')).owner).toBe('999999:successor');
  });

  it('reports the timeout it actually waited for', async () => {
    const clock = fakeClock();
    const lock = createFileRefreshLock(SLOT, {
      directory,
      staleAfterMs: 20_000,
      timeoutMs: 250,
      retryDelayMs: 25,
      now: clock.now,
      sleep: clock.sleep,
    });
    writeFileSync(lockPath(), JSON.stringify({ owner: '999999:alive', startedAt: clock.start }));

    await expect(lock.withLock(async () => 'nope')).rejects.toMatchObject({
      name: 'RefreshLockTimeoutError',
      timeoutMs: 250,
      lockPath: lockPath(),
    });
  });
});

describe('refreshLock without a usable lock directory', () => {
  it('runs the work unlocked rather than failing authentication', async () => {
    // A path whose parent is a file cannot be created — the read-only-home and
    // sandboxed cases reach here the same way. Blocking every refresh because
    // the guard is unavailable would be worse than running unguarded.
    const file = join(directory, 'not-a-directory');
    writeFileSync(file, 'x');
    const lock = createFileRefreshLock(SLOT, { directory: join(file, 'locks'), retryDelayMs: 1, timeoutMs: 50 });

    await expect(lock.withLock(async () => 'ran anyway')).resolves.toBe('ran anyway');
  });
});

describe('noopRefreshLock', () => {
  it('passes work straight through and writes nothing', async () => {
    const before = readdirSync(directory).length;

    await expect(noopRefreshLock.withLock(async () => 'ran')).resolves.toBe('ran');

    expect(readdirSync(directory).length).toBe(before);
  });
});
