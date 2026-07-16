import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  POST_CHECKOUT_HOOK_MARKER,
  ensureConventionLink,
  ensureLocalExclude,
  ensurePostCheckoutHook,
  inspectConventionLink,
  toAnchoredExcludePattern,
} from '../src/utils/conventionLink.js';
import { findProjectConfig } from '../src/utils/config.js';

const describePosix = process.platform === 'win32' ? describe.skip : describe;

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-convention-link-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function createNonGitRoot(): { rootDir: string; repoDir: string } {
  const rootDir = createTempDir();
  mkdirSync(join(rootDir, '.agentteams'), { recursive: true });
  writeFileSync(
    join(rootDir, '.agentteams', 'config.json'),
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'api-key-1' }),
    'utf-8',
  );
  writeFileSync(join(rootDir, '.agentteams', 'convention.md'), '# Root convention\n', 'utf-8');

  const repoDir = join(rootDir, 'member');
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
  writeFileSync(join(repoDir, '.gitignore'), 'dist\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore'], { cwd: repoDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: repoDir },
  );

  return { rootDir, repoDir };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('toAnchoredExcludePattern', () => {
  it('anchors repo-root relative paths', () => {
    expect(toAnchoredExcludePattern('.agentteams')).toBe('/.agentteams');
    expect(toAnchoredExcludePattern('CLAUDE.md')).toBe('/CLAUDE.md');
    expect(toAnchoredExcludePattern('.cursor/rules/agentteams.mdc')).toBe('/.cursor/rules/agentteams.mdc');
  });
});

describe('ensureConventionLink', () => {
  it('creates a link that canonically resolves to the root .agentteams and is idempotent', () => {
    const { rootDir, repoDir } = createNonGitRoot();

    const first = ensureConventionLink(rootDir, repoDir);
    expect(first).toMatchObject({ status: 'ready', state: 'ready', changed: true });

    const linkPath = join(repoDir, '.agentteams');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(join(rootDir, '.agentteams')));

    if (process.platform !== 'win32') {
      expect(isAbsolute(readlinkSync(linkPath))).toBe(false);
    }

    const second = ensureConventionLink(rootDir, repoDir);
    expect(second).toMatchObject({ status: 'ready', state: 'ready', changed: false });
  });

  it('lets findProjectConfig reach the root config from the member repo and its linked worktree', () => {
    const { rootDir, repoDir } = createNonGitRoot();
    ensureConventionLink(rootDir, repoDir);

    const rootConfigPath = join(rootDir, '.agentteams', 'config.json');
    const memberConfigPath = findProjectConfig(repoDir);
    expect(memberConfigPath).not.toBeNull();
    expect(realpathSync(memberConfigPath!)).toBe(realpathSync(rootConfigPath));

    const worktreeDir = join(createTempDir(), 'linked');
    execFileSync('git', ['worktree', 'add', '-b', 'link-test', worktreeDir], { cwd: repoDir });

    const worktreeConfigPath = findProjectConfig(worktreeDir);
    expect(worktreeConfigPath).not.toBeNull();
    expect(readFileSync(worktreeConfigPath!, 'utf-8')).toBe(readFileSync(rootConfigPath, 'utf-8'));
  });

  it('preserves a broken link and reports an issue', () => {
    const { rootDir, repoDir } = createNonGitRoot();
    const linkPath = join(repoDir, '.agentteams');
    symlinkSync(join(repoDir, 'missing-target'), linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    expect(inspectConventionLink(rootDir, repoDir)).toBe('broken');

    const result = ensureConventionLink(rootDir, repoDir);
    expect(result).toMatchObject({ status: 'blocked', state: 'broken', changed: false });
    expect(result.issue?.code).toBe('link-broken');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });

  it('preserves a link pointing at a different target', () => {
    const { rootDir, repoDir } = createNonGitRoot();
    const otherTarget = join(createTempDir(), 'other');
    mkdirSync(otherTarget, { recursive: true });
    const linkPath = join(repoDir, '.agentteams');
    symlinkSync(otherTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    const result = ensureConventionLink(rootDir, repoDir);
    expect(result).toMatchObject({ status: 'blocked', state: 'wrong-target', changed: false });
    expect(result.issue?.code).toBe('link-wrong-target');
    expect(realpathSync(linkPath)).toBe(realpathSync(otherTarget));
  });

  it('preserves an existing real directory and its contents', () => {
    const { rootDir, repoDir } = createNonGitRoot();
    const occupiedPath = join(repoDir, '.agentteams');
    mkdirSync(occupiedPath);
    writeFileSync(join(occupiedPath, 'marker.txt'), 'keep me\n', 'utf-8');

    const result = ensureConventionLink(rootDir, repoDir);
    expect(result).toMatchObject({ status: 'blocked', state: 'occupied', changed: false });
    expect(result.issue?.code).toBe('link-occupied');
    expect(readFileSync(join(occupiedPath, 'marker.txt'), 'utf-8')).toBe('keep me\n');
  });

  it('reports a missing convention root without creating anything', () => {
    const { rootDir, repoDir } = createNonGitRoot();
    rmSync(join(rootDir, '.agentteams'), { recursive: true, force: true });

    const result = ensureConventionLink(rootDir, repoDir);
    expect(result).toMatchObject({ status: 'blocked', changed: false });
    expect(result.issue?.code).toBe('root-agentteams-missing');
    expect(existsSync(join(repoDir, '.agentteams'))).toBe(false);
  });
});

describe('ensureLocalExclude', () => {
  it('appends anchored patterns once, preserving existing content and .gitignore bytes', () => {
    const { repoDir } = createNonGitRoot();
    const excludePath = join(repoDir, '.git', 'info', 'exclude');
    const priorExclude = readFileSync(excludePath, 'utf-8');
    const priorGitignore = readFileSync(join(repoDir, '.gitignore'), 'utf-8');

    const patterns = ['/.agentteams', '/CLAUDE.md'];
    const first = ensureLocalExclude(repoDir, patterns);
    expect(first).toMatchObject({ status: 'ready', changed: true, addedPatterns: patterns });

    const content = readFileSync(excludePath, 'utf-8');
    expect(content.startsWith(priorExclude)).toBe(true);
    for (const pattern of patterns) {
      const occurrences = content.split('\n').filter((line) => line === pattern);
      expect(occurrences).toHaveLength(1);
    }

    const second = ensureLocalExclude(repoDir, patterns);
    expect(second).toMatchObject({ status: 'ready', changed: false, addedPatterns: [] });
    expect(readFileSync(excludePath, 'utf-8')).toBe(content);
    expect(readFileSync(join(repoDir, '.gitignore'), 'utf-8')).toBe(priorGitignore);
  });

  it('adds a separating newline when the existing exclude file has no trailing newline', () => {
    const { repoDir } = createNonGitRoot();
    const excludePath = join(repoDir, '.git', 'info', 'exclude');
    writeFileSync(excludePath, '*.log', 'utf-8');

    const result = ensureLocalExclude(repoDir, ['/.agentteams']);
    expect(result).toMatchObject({ status: 'ready', changed: true });
    expect(readFileSync(excludePath, 'utf-8')).toBe('*.log\n/.agentteams\n');
  });

  it('reports non-git directories as blocked', () => {
    const plainDir = createTempDir();

    const result = ensureLocalExclude(plainDir, ['/.agentteams']);
    expect(result).toMatchObject({ status: 'blocked', changed: false, excludePath: null });
    expect(result.issue?.code).toBe('not-a-git-repo');
  });

  describePosix('unsafe metadata paths', () => {
    it('rejects a symlinked exclude file without modifying its external target', () => {
      const { repoDir } = createNonGitRoot();
      const excludePath = join(repoDir, '.git', 'info', 'exclude');
      const outsidePath = join(createTempDir(), 'outside-exclude.txt');
      writeFileSync(outsidePath, 'SENTINEL\n', 'utf-8');
      rmSync(excludePath);
      symlinkSync(outsidePath, excludePath, 'file');

      const result = ensureLocalExclude(repoDir, ['/.agentteams']);

      expect(result).toMatchObject({ status: 'blocked', changed: false });
      expect(result.issue?.code).toBe('exclude-unsafe-path');
      expect(readFileSync(outsidePath, 'utf-8')).toBe('SENTINEL\n');
    });
  });
});

describe('ensurePostCheckoutHook', () => {
  it('installs the managed hook with shebang, marker, and execute permission, idempotently', () => {
    const { repoDir } = createNonGitRoot();

    const first = ensurePostCheckoutHook(repoDir);
    expect(first).toMatchObject({ status: 'ready', changed: true });

    const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
    expect(first.hookPath).toBe(hookPath);

    const lines = readFileSync(hookPath, 'utf-8').split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines[1]).toBe(POST_CHECKOUT_HOOK_MARKER);

    if (process.platform !== 'win32') {
      expect(statSync(hookPath).mode & 0o111).not.toBe(0);
    }

    const second = ensurePostCheckoutHook(repoDir);
    expect(second).toMatchObject({ status: 'ready', changed: false });
  });

  it('preserves an unmanaged post-checkout hook', () => {
    const { repoDir } = createNonGitRoot();
    const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
    const customHook = '#!/bin/sh\necho custom hook\n';
    writeFileSync(hookPath, customHook, { encoding: 'utf-8', mode: 0o755 });

    const result = ensurePostCheckoutHook(repoDir);
    expect(result).toMatchObject({ status: 'blocked', changed: false });
    expect(result.issue?.code).toBe('hook-custom');
    expect(readFileSync(hookPath, 'utf-8')).toBe(customHook);
  });

  it('does not install anything when core.hooksPath is configured', () => {
    const { repoDir } = createNonGitRoot();
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoDir });

    const result = ensurePostCheckoutHook(repoDir);
    expect(result).toMatchObject({ status: 'blocked', changed: false, hookPath: null });
    expect(result.issue?.code).toBe('hook-hookspath');
    expect(existsSync(join(repoDir, '.git', 'hooks', 'post-checkout'))).toBe(false);
  });

  describePosix('unsafe metadata paths', () => {
    it('rejects a symlinked hook without modifying its external target', () => {
      const { repoDir } = createNonGitRoot();
      const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
      const outsidePath = join(createTempDir(), 'outside-hook.sh');
      writeFileSync(outsidePath, `#!/bin/sh\n${POST_CHECKOUT_HOOK_MARKER}\necho outside\n`, 'utf-8');
      symlinkSync(outsidePath, hookPath, 'file');

      const result = ensurePostCheckoutHook(repoDir);

      expect(result).toMatchObject({ status: 'blocked', changed: false });
      expect(result.issue?.code).toBe('hook-unsafe-path');
      expect(readFileSync(outsidePath, 'utf-8')).toContain('echo outside');
    });
  });
});

describePosix('managed hook runtime behavior', () => {
  function createStub(stubDir: string, recordPath: string, exitCode: number): void {
    mkdirSync(stubDir, { recursive: true });
    const stubPath = join(stubDir, 'agentteams');
    writeFileSync(stubPath, `#!/bin/sh\necho "$@" >> "${recordPath}"\nexit ${exitCode}\n`, {
      encoding: 'utf-8',
      mode: 0o755,
    });
  }

  function readRecord(recordPath: string): string[] {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, 'utf-8').split('\n').filter(Boolean);
  }

  it('runs agentteams init on git worktree add but not on a regular branch checkout', () => {
    const { repoDir } = createNonGitRoot();
    ensurePostCheckoutHook(repoDir);

    const stubDir = join(createTempDir(), 'bin');
    const recordPath = join(stubDir, 'record.log');
    createStub(stubDir, recordPath, 0);
    const env = { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}` };

    const worktreeDir = join(createTempDir(), 'hooked-worktree');
    const add = spawnSync('git', ['worktree', 'add', '-b', 'hooked', worktreeDir], {
      cwd: repoDir,
      env,
      encoding: 'utf-8',
    });
    expect(add.status).toBe(0);
    expect(readRecord(recordPath)).toEqual(['init --format json']);

    const checkout = spawnSync('git', ['checkout', '-b', 'regular-branch'], { cwd: repoDir, env, encoding: 'utf-8' });
    expect(checkout.status).toBe(0);
    expect(readRecord(recordPath)).toEqual(['init --format json']);
  });

  it('keeps git worktree add succeeding and warns on stderr when agentteams init fails', () => {
    const { repoDir } = createNonGitRoot();
    ensurePostCheckoutHook(repoDir);

    const stubDir = join(createTempDir(), 'bin');
    const recordPath = join(stubDir, 'record.log');
    createStub(stubDir, recordPath, 1);
    const env = { ...process.env, PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}` };

    const worktreeDir = join(createTempDir(), 'failing-worktree');
    const add = spawnSync('git', ['worktree', 'add', '-b', 'failing', worktreeDir], {
      cwd: repoDir,
      env,
      encoding: 'utf-8',
    });
    expect(add.status).toBe(0);
    expect(add.stderr).toContain('agentteams: worktree bootstrap failed');
  });

  it('keeps git worktree add succeeding and warns on stderr when agentteams is not in PATH', () => {
    const { repoDir } = createNonGitRoot();
    ensurePostCheckoutHook(repoDir);

    const env = { ...process.env, PATH: '/usr/bin:/bin' };

    const worktreeDir = join(createTempDir(), 'no-cli-worktree');
    const add = spawnSync('git', ['worktree', 'add', '-b', 'no-cli', worktreeDir], {
      cwd: repoDir,
      env,
      encoding: 'utf-8',
    });
    expect(add.status).toBe(0);
    expect(add.stderr).toContain('agentteams: skipped worktree bootstrap');
  });
});
