import { describe, expect, it, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashProjectRootPath, normalizeProjectRootPath, resolveProjectRootHash } from '../src/utils/projectRootHash.js';

const createdRoots: string[] = [];

const createProject = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentteams-root-hash-')));
  createdRoots.push(root);
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ teamId: 't', projectId: 'p' }));
  return root;
};

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('normalizeProjectRootPath', () => {
  it('gives a Windows path the same spelling as its POSIX equivalent', () => {
    expect(normalizeProjectRootPath('C:\\Users\\me\\repo')).toBe('C:/Users/me/repo');
  });

  it('drops trailing separators so /repo and /repo/ hash the same', () => {
    expect(normalizeProjectRootPath('/home/me/repo/')).toBe('/home/me/repo');
    expect(normalizeProjectRootPath('/home/me/repo///')).toBe('/home/me/repo');
  });

  it('keeps the POSIX root instead of normalizing it to an empty string', () => {
    expect(normalizeProjectRootPath('/')).toBe('/');
  });

  // 대소문자를 낮추면 대소문자 구분 파일시스템에서 서로 다른 두 디렉토리가 충돌해
  // 틀린 에이전트가 귀속된다. 못 맞추고 비는 것이 의도된 실패 모드다.
  it('does not fold case', () => {
    expect(normalizeProjectRootPath('/Home/Me/Repo')).not.toBe(normalizeProjectRootPath('/home/me/repo'));
  });
});

describe('hashProjectRootPath', () => {
  it('is the lowercase hex sha256 of the normalized path', () => {
    const expected = createHash('sha256').update('/home/me/repo', 'utf8').digest('hex');
    expect(hashProjectRootPath('/home/me/repo/')).toBe(expected);
    expect(hashProjectRootPath('/home/me/repo')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveProjectRootHash', () => {
  it('produces the same hash from a subdirectory as from the project root', () => {
    const root = createProject();
    const nested = join(root, 'api', 'src', 'routes');
    mkdirSync(nested, { recursive: true });

    expect(resolveProjectRootHash(nested)).toBe(resolveProjectRootHash(root));
    expect(resolveProjectRootHash(root)).toBe(hashProjectRootPath(root));
  });

  it('returns null when no project config anchors the path', () => {
    const orphan = realpathSync(mkdtempSync(join(tmpdir(), 'agentteams-no-config-')));
    createdRoots.push(orphan);

    expect(resolveProjectRootHash(orphan)).toBeNull();
  });
});
