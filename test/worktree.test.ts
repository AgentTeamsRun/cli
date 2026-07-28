import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { WorktreeLifecycleEvent } from '../src/api/worktree.js';
import {
  computeWorktreeLocalKey,
  createDefaultWorktreeEventId,
  scheduleDeletedEventAfterRemoval,
  waitForPathRemoval,
} from '../src/commands/worktree.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('worktree lifecycle identity', () => {
  it('uses the same canonical-path hash as Runner discovery', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-key-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    const canonicalPath = realpathSync(worktreePath);
    const runnerLocalKey = createHash('sha256').update(canonicalPath).digest('hex');

    expect(computeWorktreeLocalKey(worktreePath)).toBe(runnerLocalKey);
  });

  it('creates a unique default event id for every lifecycle occurrence', () => {
    const first = createDefaultWorktreeEventId('CREATED');
    const second = createDefaultWorktreeEventId('CREATED');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^orca:created:[0-9a-f-]{36}$/u);
  });
});

describe('delete notification delivery guard', () => {
  it('uses CREATE_NO_WINDOW without DETACHED_PROCESS on Windows', () => {
    const unref = jest.fn();
    const spawn = jest.fn(() => ({ unref }));
    const event: WorktreeLifecycleEvent = {
      event: 'DELETED',
      eventId: 'event-1',
      occurredAt: '2026-07-28T00:00:00.000Z',
      localKey: 'local-key',
    };

    scheduleDeletedEventAfterRemoval('C:\\repo\\worktree', 'C:\\repo', event, {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      entryPath: 'C:\\agentteams\\index.js',
      env: {},
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      ['C:\\agentteams\\index.js', 'worktree', 'deliver-deleted'],
      expect.objectContaining({ detached: false, windowsHide: true, stdio: 'ignore' }),
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('preserves detached process groups outside Windows', () => {
    const spawn = jest.fn(() => ({ unref: jest.fn() }));
    const event: WorktreeLifecycleEvent = {
      event: 'DELETED',
      eventId: 'event-2',
      occurredAt: '2026-07-28T00:00:00.000Z',
      localKey: 'local-key',
    };

    scheduleDeletedEventAfterRemoval('/repo/worktree', '/repo', event, {
      platform: 'linux',
      execPath: '/usr/bin/node',
      entryPath: '/agentteams/index.js',
      env: {},
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['/agentteams/index.js', 'worktree', 'deliver-deleted'],
      expect.objectContaining({ detached: true, windowsHide: true, stdio: 'ignore' }),
    );
  });

  it('delivers only after the worktree path disappears', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-remove-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    setTimeout(() => rmSync(worktreePath, { recursive: true }), 10);

    await expect(waitForPathRemoval(worktreePath, { intervalMs: 5, timeoutMs: 100 })).resolves.toBe(true);
  });

  it('does not deliver when removal fails and the path remains', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-stays-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    await expect(waitForPathRemoval(worktreePath, { intervalMs: 5, timeoutMs: 20 })).resolves.toBe(false);
  });
});
