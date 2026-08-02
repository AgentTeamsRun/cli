import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMachineIdPath, readOrCreateMachineId } from '../src/utils/machineId.js';

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agentteams-machine-id-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('machine id', () => {
  test('resolves the same file the runner uses', () => {
    expect(getMachineIdPath()).toBe(join(homedir(), '.agentteams', 'machine-id'));
  });

  test('creates the file once and reuses the value', () => {
    const path = join(createTempDir(), 'nested', 'machine-id');

    const first = readOrCreateMachineId({ path });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(path, 'utf8').trim()).toBe(first);
    expect(readOrCreateMachineId({ path })).toBe(first);

    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  test('reuses a value written by the runner', () => {
    const path = join(createTempDir(), 'machine-id');
    writeFileSync(path, 'runner-machine-id\n', 'utf8');

    expect(readOrCreateMachineId({ path })).toBe('runner-machine-id');
  });

  test('returns null when the file can be neither read nor written', () => {
    const resolved = readOrCreateMachineId({
      path: '/machine-id',
      readFile: () => {
        throw new Error('EACCES');
      },
      writeFileExclusive: () => {
        throw new Error('EACCES');
      },
    });

    expect(resolved).toBeNull();
  });
});
