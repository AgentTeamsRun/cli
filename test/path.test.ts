import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizePath, isSamePath } from '../src/utils/path.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('path identity', () => {
  it('canonicalizes filesystem aliases to one path', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-path-test-'));
    tempDirs.push(tempDir);
    const targetDir = join(tempDir, 'target');
    const aliasDir = join(tempDir, 'alias');
    mkdirSync(targetDir);
    symlinkSync(targetDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');

    expect(canonicalizePath(aliasDir)).toBe(canonicalizePath(targetDir));
    expect(isSamePath(aliasDir, targetDir)).toBe(true);
  });

  it('returns false when either path does not exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-path-test-'));
    tempDirs.push(tempDir);

    expect(isSamePath(tempDir, join(tempDir, 'missing'))).toBe(false);
  });
});
