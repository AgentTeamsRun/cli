import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BACKUP_SUFFIX,
  PROJECT_SCOPE_FILE_MODE,
  USER_SCOPE_FILE_MODE,
  writeConfigFileAtomically,
} from '../src/mcp-registration/atomicWrite.js';

const tempDirs: string[] = [];
// POSIX permission bits are the thing under test; Windows has no equivalent.
const posixIt = process.platform === 'win32' ? it.skip : it;

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-atomic-write-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('writeConfigFileAtomically', () => {
  posixIt('narrows the backup to the target mode when a 0644 config becomes user scope', () => {
    const path = join(createTempDir(), 'mcp.json');
    writeFileSync(path, '{"mcpServers":{}}\n', { encoding: 'utf-8', mode: 0o644 });

    const result = writeConfigFileAtomically(path, '{"mcpServers":{"agentteams":{}}}\n', 0o644, USER_SCOPE_FILE_MODE);

    expect(result.mode).toBe(USER_SCOPE_FILE_MODE);
    expect(statSync(path).mode & 0o777).toBe(USER_SCOPE_FILE_MODE);
    expect(result.backupPath).toBe(`${path}${BACKUP_SUFFIX}`);
    expect(statSync(result.backupPath as string).mode & 0o777).toBe(USER_SCOPE_FILE_MODE);
  });

  posixIt('keeps the existing mode on both files when no target mode is forced', () => {
    const path = join(createTempDir(), 'mcp.json');
    writeFileSync(path, '{"mcpServers":{}}\n', { encoding: 'utf-8', mode: 0o644 });

    const result = writeConfigFileAtomically(path, '{"mcpServers":{"agentteams":{}}}\n', PROJECT_SCOPE_FILE_MODE);

    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(statSync(result.backupPath as string).mode & 0o777).toBe(0o644);
  });

  posixIt('replaces a wider backup left by an earlier version instead of inheriting its mode', () => {
    const path = join(createTempDir(), 'mcp.json');
    const backupPath = `${path}${BACKUP_SUFFIX}`;
    writeFileSync(path, '{"mcpServers":{"current":{}}}\n');
    chmodSync(path, 0o600);
    // What an older CLI left behind: a predictable path holding an API key at 0644.
    writeFileSync(backupPath, '{"mcpServers":{"stale":{}}}\n');
    chmodSync(backupPath, 0o644);

    const staleInode = statSync(backupPath).ino;

    writeConfigFileAtomically(path, '{"mcpServers":{"agentteams":{}}}\n', 0o644, USER_SCOPE_FILE_MODE);

    expect(statSync(backupPath).mode & 0o777).toBe(USER_SCOPE_FILE_MODE);
    expect(readFileSync(backupPath, 'utf-8')).toBe('{"mcpServers":{"current":{}}}\n');
    // A fresh inode proves the secret was never written into the 0644 file that
    // was already sitting there; the wide one is unlinked by the rename instead.
    expect(statSync(backupPath).ino).not.toBe(staleInode);
  });

  it('leaves no new copy of the secret behind when the backup chmod fails', async () => {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return;
    }

    const directory = createTempDir();
    const path = join(directory, 'mcp.json');
    const backupPath = `${path}${BACKUP_SUFFIX}`;
    writeFileSync(path, '{"mcpServers":{"current":{}}}\n');
    writeFileSync(backupPath, '{"mcpServers":{"stale":{}}}\n');

    jest.resetModules();
    const realFs = await import('node:fs');
    const refuse = () => {
      throw new Error('chmod refused');
    };
    const mockedFs = { ...realFs, chmodSync: jest.fn(refuse), fchmodSync: jest.fn(refuse) };
    (jest as any).unstable_mockModule('node:fs', () => ({ __esModule: true, ...mockedFs, default: mockedFs }));

    try {
      const { writeConfigFileAtomically: writeWithFailingChmod } =
        await import('../src/mcp-registration/atomicWrite.js');

      expect(() =>
        writeWithFailingChmod(path, '{"mcpServers":{"agentteams":{}}}\n', 0o644, USER_SCOPE_FILE_MODE),
      ).toThrow('chmod refused');
    } finally {
      jest.resetModules();
    }

    // No partial backup, no temp file: only the original and the untouched earlier backup.
    expect(readdirSync(directory).sort()).toEqual(['mcp.json', `mcp.json${BACKUP_SUFFIX}`]);
    expect(readFileSync(path, 'utf-8')).toBe('{"mcpServers":{"current":{}}}\n');
    expect(readFileSync(backupPath, 'utf-8')).toBe('{"mcpServers":{"stale":{}}}\n');
  });

  it('writes a new file without leaving a backup or a temp file behind', () => {
    const directory = createTempDir();
    const path = join(directory, 'mcp.json');

    const result = writeConfigFileAtomically(path, '{"mcpServers":{}}\n', PROJECT_SCOPE_FILE_MODE);

    expect(result.created).toBe(true);
    expect(result.backupPath).toBeNull();
    expect(existsSync(`${path}${BACKUP_SUFFIX}`)).toBe(false);
    expect(readdirSync(directory)).toEqual(['mcp.json']);
    expect(readFileSync(path, 'utf-8')).toBe('{"mcpServers":{}}\n');
  });
});
