import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMemberRepos, isNonGitRootProject } from '../src/utils/projectLayout.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-project-layout-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeRootConfig(rootDir: string): void {
  mkdirSync(join(rootDir, '.agentteams'), { recursive: true });
  writeFileSync(
    join(rootDir, '.agentteams', 'config.json'),
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'api-key-1' }),
    'utf-8',
  );
}

function createGitRepository(repositoryDir: string): void {
  mkdirSync(repositoryDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repositoryDir });
  writeFileSync(join(repositoryDir, 'README.md'), '# member\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: repositoryDir },
  );
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('isNonGitRootProject', () => {
  it('returns true for a configured directory outside any git work tree', () => {
    const rootDir = createTempDir();
    writeRootConfig(rootDir);

    expect(isNonGitRootProject(rootDir)).toBe(true);
  });

  it('returns false when the directory has no .agentteams config', () => {
    const rootDir = createTempDir();

    expect(isNonGitRootProject(rootDir)).toBe(false);
  });

  it('returns false for a configured git repository root', () => {
    const tempDir = createTempDir();
    const repositoryDir = join(tempDir, 'repo');
    createGitRepository(repositoryDir);
    writeRootConfig(repositoryDir);

    expect(isNonGitRootProject(repositoryDir)).toBe(false);
  });

  it('returns false for a configured subdirectory inside a git repository', () => {
    const tempDir = createTempDir();
    const repositoryDir = join(tempDir, 'repo');
    createGitRepository(repositoryDir);
    const nestedDir = join(repositoryDir, 'packages', 'app');
    mkdirSync(nestedDir, { recursive: true });
    writeRootConfig(nestedDir);

    expect(isNonGitRootProject(nestedDir)).toBe(false);
  });
});

describe('findMemberRepos', () => {
  it('returns only direct child git repositories, sorted by path', () => {
    const rootDir = createTempDir();
    writeRootConfig(rootDir);

    createGitRepository(join(rootDir, 'beta'));
    createGitRepository(join(rootDir, 'alpha'));
    mkdirSync(join(rootDir, 'plain-directory'));
    createGitRepository(join(rootDir, '.hidden-repo'));
    createGitRepository(join(rootDir, 'node_modules'));

    expect(findMemberRepos(rootDir)).toEqual([join(rootDir, 'alpha'), join(rootDir, 'beta')]);
  });

  it('does not scan recursively below depth 1', () => {
    const rootDir = createTempDir();
    writeRootConfig(rootDir);
    createGitRepository(join(rootDir, 'plain-parent', 'nested-repo'));

    expect(findMemberRepos(rootDir)).toEqual([]);
  });

  it('excludes bare repositories', () => {
    const rootDir = createTempDir();
    writeRootConfig(rootDir);
    const bareDir = join(rootDir, 'bare-repo');
    mkdirSync(bareDir);
    execFileSync('git', ['init', '--bare'], { cwd: bareDir });

    expect(findMemberRepos(rootDir)).toEqual([]);
  });

  it('excludes symlinked directories even when they point to a repository', () => {
    const rootDir = createTempDir();
    const outsideDir = createTempDir();
    writeRootConfig(rootDir);
    const realRepo = join(outsideDir, 'real-repo');
    createGitRepository(realRepo);
    symlinkSync(realRepo, join(rootDir, 'linked-repo'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(findMemberRepos(rootDir)).toEqual([]);
  });

  it('returns an empty list when the root directory is unreadable', () => {
    const rootDir = createTempDir();

    expect(findMemberRepos(join(rootDir, 'missing'))).toEqual([]);
  });
});
