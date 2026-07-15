import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapLinkedWorktree, buildAuthorizeUrl, detectOsType, executeInitCommand } from '../src/commands/init.js';

const tempDirs: string[] = [];

function createRepository(): { repositoryDir: string; worktreeDir: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-init-worktree-test-'));
  tempDirs.push(tempDir);
  const repositoryDir = join(tempDir, 'main');
  const worktreeDir = join(tempDir, 'worktree');
  mkdirSync(repositoryDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repositoryDir });
  writeFileSync(join(repositoryDir, '.gitignore'), '.agentteams\n', 'utf-8');
  writeFileSync(join(repositoryDir, 'AGENTS.md'), '# Agent instructions\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore', 'AGENTS.md'], { cwd: repositoryDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: repositoryDir },
  );
  mkdirSync(join(repositoryDir, '.agentteams'));
  writeFileSync(
    join(repositoryDir, '.agentteams', 'config.json'),
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'api-key-1' }),
    'utf-8',
  );
  writeFileSync(join(repositoryDir, '.agentteams', 'convention.md'), '# Convention chain restored\n', 'utf-8');
  execFileSync('git', ['worktree', 'add', '-b', 'worktree-test', worktreeDir], { cwd: repositoryDir });
  return { repositoryDir, worktreeDir };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('init helpers', () => {
  test('buildAuthorizeUrl includes authPathEnc and osType when provided', () => {
    const url = buildAuthorizeUrl(9876, 'demo', 'enc-value', 'LINUX');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('port')).toBe('9876');
    expect(parsed.searchParams.get('projectName')).toBe('demo');
    expect(parsed.searchParams.get('ap')).toBe('enc-value');
    expect(parsed.searchParams.get('ot')).toBe('LINUX');
  });

  test('detectOsType maps process.platform to supported values', () => {
    const result = detectOsType();

    if (process.platform === 'darwin') {
      expect(result).toBe('MACOS');
      return;
    }

    if (process.platform === 'linux') {
      expect(result).toBe('LINUX');
      return;
    }

    if (process.platform === 'win32') {
      expect(result).toBe('WINDOWS');
      return;
    }

    expect(result).toBeUndefined();
  });
});

describe('linked worktree bootstrap', () => {
  test('init links the main checkout config without OAuth or prompts', async () => {
    const { worktreeDir } = createRepository();

    const result = await executeInitCommand({ cwd: worktreeDir });

    expect(result).toMatchObject({ mode: 'worktree', materialization: 'symlink' });
    expect(lstatSync(join(worktreeDir, '.agentteams')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(worktreeDir, '.agentteams', 'convention.md'), 'utf-8')).toBe(
      '# Convention chain restored\n',
    );
  });

  test('init leaves an existing worktree config unchanged', async () => {
    const { worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    mkdirSync(targetPath);
    writeFileSync(join(targetPath, 'marker.txt'), 'keep me\n', 'utf-8');

    const result = await executeInitCommand({ cwd: worktreeDir });

    expect(result).toMatchObject({ mode: 'worktree', materialization: 'existing' });
    expect(readFileSync(join(targetPath, 'marker.txt'), 'utf-8')).toBe('keep me\n');
  });

  test('does not bootstrap from a nested directory in a linked worktree', () => {
    const { worktreeDir } = createRepository();
    const nestedProjectDir = join(worktreeDir, 'packages', 'app');
    mkdirSync(nestedProjectDir, { recursive: true });

    expect(bootstrapLinkedWorktree(nestedProjectDir)).toBeNull();
  });

  test('does not report success when the main checkout config is incomplete', () => {
    const { repositoryDir, worktreeDir } = createRepository();
    writeFileSync(join(repositoryDir, '.agentteams', 'config.json'), '{}\n', 'utf-8');

    expect(bootstrapLinkedWorktree(worktreeDir)).toBeNull();
  });

  test('replaces a broken .agentteams symlink', async () => {
    const { worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    symlinkSync(join(worktreeDir, 'missing-agentteams'), targetPath, 'dir');

    const result = await executeInitCommand({ cwd: worktreeDir });

    expect(result).toMatchObject({ mode: 'worktree', materialization: 'symlink' });
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(targetPath, 'config.json'), 'utf-8')).toContain('project-1');
  });

  test('non-worktree repositories continue to the existing interactive path', () => {
    const { repositoryDir } = createRepository();

    expect(bootstrapLinkedWorktree(repositoryDir)).toBeNull();
  });
});
