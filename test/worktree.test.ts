import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { computeWorktreeLocalKey, createDefaultWorktreeEventId, waitForPathRemoval } from '../src/commands/worktree.js';

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
