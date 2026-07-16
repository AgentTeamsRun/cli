import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapLinkedWorktree,
  buildAuthorizeUrl,
  detectOsType,
  executeInitCommand,
  type WorktreeInitResult,
} from '../src/commands/init.js';

const tempDirs: string[] = [];
const testPosix = process.platform === 'win32' ? test.skip : test;

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

function createNonGitRootWithLinkedMember(): {
  rootDir: string;
  memberDir: string;
  worktreeDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-init-non-git-root-test-'));
  tempDirs.push(tempDir);

  const rootDir = join(tempDir, 'project-root');
  mkdirSync(join(rootDir, '.agentteams'), { recursive: true });
  writeFileSync(
    join(rootDir, '.agentteams', 'config.json'),
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'api-key-1' }),
    'utf-8',
  );
  writeFileSync(join(rootDir, '.agentteams', 'convention.md'), '# Root convention\n', 'utf-8');
  writeFileSync(join(rootDir, 'CLAUDE.md'), '# Root CLAUDE entry point\n', 'utf-8');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Root AGENTS entry point\n', 'utf-8');

  const memberDir = join(rootDir, 'member');
  mkdirSync(memberDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: memberDir });
  writeFileSync(join(memberDir, 'README.md'), '# member\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd: memberDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: memberDir },
  );
  symlinkSync(
    join(rootDir, '.agentteams'),
    join(memberDir, '.agentteams'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const worktreeDir = join(tempDir, 'member-worktree');
  execFileSync('git', ['worktree', 'add', '-b', 'member-worktree-test', worktreeDir], { cwd: memberDir });

  return { rootDir, memberDir, worktreeDir };
}

function expectMaterializedConfig(result: WorktreeInitResult, worktreeDir: string): void {
  const targetPath = join(worktreeDir, '.agentteams');

  expect(result).toMatchObject({ mode: 'worktree' });
  expect(readFileSync(join(targetPath, 'convention.md'), 'utf-8')).toBe('# Convention chain restored\n');

  if (result.materialization === 'symlink') {
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
    return;
  }

  expect(process.platform).toBe('win32');
  expect(result).toMatchObject({
    materialization: 'copy',
    warning: expect.stringMatching(/Could not create the \.agentteams symlink .*Copied the directory instead\./),
  });
  expect(lstatSync(targetPath).isDirectory()).toBe(true);
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
  test('init materializes the main checkout config without OAuth or prompts', async () => {
    const { worktreeDir } = createRepository();

    const result = await executeInitCommand({ cwd: worktreeDir });

    expectMaterializedConfig(result as WorktreeInitResult, worktreeDir);
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
    const missingTargetPath = join(worktreeDir, 'missing-agentteams');
    mkdirSync(missingTargetPath);
    symlinkSync(missingTargetPath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    rmSync(missingTargetPath, { recursive: true, force: true });

    const result = await executeInitCommand({ cwd: worktreeDir });

    expectMaterializedConfig(result as WorktreeInitResult, worktreeDir);
    expect(readFileSync(join(targetPath, 'config.json'), 'utf-8')).toContain('project-1');
  });

  test('non-worktree repositories continue to the existing interactive path', () => {
    const { repositoryDir } = createRepository();

    expect(bootstrapLinkedWorktree(repositoryDir)).toBeNull();
  });

  test('reports tracked entry points for a plain main checkout worktree', async () => {
    const { worktreeDir } = createRepository();

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.entryPoints).toEqual([{ relativePath: 'AGENTS.md', state: 'tracked' }]);
    expect(result.issues).toEqual([]);
  });
});

describe('non-git root entry point materialization', () => {
  test('materializes only the convention root entry point set through a double link', async () => {
    const { rootDir, worktreeDir } = createNonGitRootWithLinkedMember();

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result).toMatchObject({ mode: 'worktree' });
    expect(readFileSync(join(worktreeDir, '.agentteams', 'convention.md'), 'utf-8')).toBe('# Root convention\n');
    expect(readFileSync(join(worktreeDir, '.agentteams', 'config.json'), 'utf-8')).toBe(
      readFileSync(join(rootDir, '.agentteams', 'config.json'), 'utf-8'),
    );

    expect(result.entryPoints).toEqual([
      { relativePath: 'CLAUDE.md', state: 'created' },
      { relativePath: 'AGENTS.md', state: 'created' },
    ]);
    expect(result.issues).toEqual([]);

    const claudeContent = readFileSync(join(worktreeDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('**Before starting any task, always refer to `.agentteams/convention.md`.**');
    expect(claudeContent).not.toContain('Root CLAUDE entry point');

    expect(existsSync(join(worktreeDir, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(worktreeDir, '.cursor'))).toBe(false);
    expect(existsSync(join(worktreeDir, 'CLAUDE-example.md'))).toBe(false);

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDir, encoding: 'utf-8' });
    expect(status.trim()).toBe('');
  });

  test('re-running init preserves managed files and reports them as existing', async () => {
    const { worktreeDir } = createNonGitRootWithLinkedMember();

    await executeInitCommand({ cwd: worktreeDir });
    const firstContent = readFileSync(join(worktreeDir, 'CLAUDE.md'), 'utf-8');

    const second = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(second.materialization).toBe('existing');
    expect(second.entryPoints).toEqual([
      { relativePath: 'CLAUDE.md', state: 'existing' },
      { relativePath: 'AGENTS.md', state: 'existing' },
    ]);
    expect(readFileSync(join(worktreeDir, 'CLAUDE.md'), 'utf-8')).toBe(firstContent);

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDir, encoding: 'utf-8' });
    expect(status.trim()).toBe('');
  });

  test('preserves tracked and pre-existing untracked entry points byte for byte', async () => {
    const { memberDir, worktreeDir } = createNonGitRootWithLinkedMember();

    const trackedContent = '# Tracked member AGENTS file\n';
    writeFileSync(join(memberDir, 'AGENTS.md'), trackedContent, 'utf-8');
    execFileSync('git', ['add', 'AGENTS.md'], { cwd: memberDir });
    execFileSync(
      'git',
      ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'track agents'],
      { cwd: memberDir },
    );
    execFileSync('git', ['checkout', 'main', '--', 'AGENTS.md'], { cwd: worktreeDir });

    const untrackedContent = '# Pre-existing untracked CLAUDE file\n';
    writeFileSync(join(worktreeDir, 'CLAUDE.md'), untrackedContent, 'utf-8');

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.entryPoints).toEqual([
      { relativePath: 'CLAUDE.md', state: 'existing' },
      { relativePath: 'AGENTS.md', state: 'tracked' },
    ]);
    expect(readFileSync(join(worktreeDir, 'AGENTS.md'), 'utf-8')).toBe(trackedContent);
    expect(readFileSync(join(worktreeDir, 'CLAUDE.md'), 'utf-8')).toBe(untrackedContent);
  });

  testPosix('does not create managed paths when local exclude is blocked', async () => {
    const { memberDir, worktreeDir } = createNonGitRootWithLinkedMember();
    const excludePath = join(memberDir, '.git', 'info', 'exclude');
    const outsideExcludePath = join(memberDir, '..', 'outside-exclude.txt');
    writeFileSync(outsideExcludePath, 'SENTINEL\n', 'utf-8');
    rmSync(excludePath);
    symlinkSync(outsideExcludePath, excludePath, 'file');

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.materialization).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toContain('exclude-unsafe-path');
    expect(result.entryPoints).toEqual([
      { relativePath: 'CLAUDE.md', state: 'blocked' },
      { relativePath: 'AGENTS.md', state: 'blocked' },
    ]);
    expect(existsSync(join(worktreeDir, '.agentteams'))).toBe(false);
    expect(existsSync(join(worktreeDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(worktreeDir, 'AGENTS.md'))).toBe(false);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDir, encoding: 'utf-8' }).trim()).toBe('');
  });
});
