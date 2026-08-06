import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeDoctorCommand } from '../src/commands/doctor.js';
import { CONFIG_FILE_MODE } from '../src/utils/config.js';
import { resolveDoctorExitCode } from '../src/utils/doctorOutput.js';
import { canonicalizePath, isSamePath } from '../src/utils/path.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-doctor-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function createRoot(options?: { entryPoints?: string[]; configBody?: string; skipConvention?: boolean }): string {
  const rootDir = join(createTempDir(), 'project-root');
  mkdirSync(join(rootDir, '.agentteams'), { recursive: true });
  writeFileSync(
    join(rootDir, '.agentteams', 'config.json'),
    options?.configBody ?? JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'secret-api-key-1' }),
    // Matches what `saveConfig` now writes, so change counts stay about the
    // layout work these tests are actually asserting.
    { encoding: 'utf-8', mode: CONFIG_FILE_MODE },
  );
  if (!options?.skipConvention) {
    writeFileSync(join(rootDir, '.agentteams', 'convention.md'), '# Root convention\n', 'utf-8');
  }
  for (const entryPoint of options?.entryPoints ?? ['CLAUDE.md', 'AGENTS.md']) {
    const fullPath = join(rootDir, entryPoint);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, `# Root ${entryPoint}\n`, 'utf-8');
  }
  return rootDir;
}

function addMemberRepo(rootDir: string, name: string): string {
  const repoDir = join(rootDir, name);
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
  writeFileSync(join(repoDir, 'README.md'), `# ${name}\n`, 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: repoDir },
  );
  return repoDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('doctor on a non-git root project', () => {
  it('prepares every member repo on the first run and reports zero changes on the second', async () => {
    const rootDir = createRoot();
    const betaDir = addMemberRepo(rootDir, 'beta');
    const alphaDir = addMemberRepo(rootDir, 'alpha');
    const nestedCwd = join(rootDir, 'docs');
    mkdirSync(nestedCwd, { recursive: true });

    const first = await executeDoctorCommand({ cwd: nestedCwd });

    expect(first.status).toBe('READY');
    expect(first.layout).toBe('non-git-root');
    expect(first.applicable).toBe(true);
    expect(isSamePath(first.rootDir!, rootDir)).toBe(true);
    expect(first.rootEntryPoints).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(first.missingRecommendedEntryPoints).toEqual([]);
    const canonicalRoot = canonicalizePath(rootDir);
    expect(first.repositories.map((repo) => repo.path)).toEqual([
      join(canonicalRoot, 'alpha'),
      join(canonicalRoot, 'beta'),
    ]);
    expect(first.repositories.map((repo) => repo.status)).toEqual(['READY', 'READY']);
    expect(first.repositories.map((repo) => repo.changedCount)).toEqual([5, 5]);
    expect(first.changedCount).toBe(10);

    for (const repoDir of [alphaDir, betaDir]) {
      expect(realpathSync(join(repoDir, '.agentteams'))).toBe(realpathSync(join(rootDir, '.agentteams')));
      const exclude = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf-8');
      expect(exclude).toContain('/.agentteams\n');
      expect(exclude).toContain('/CLAUDE.md\n');
      expect(exclude).toContain('/AGENTS.md\n');
      expect(readFileSync(join(repoDir, 'CLAUDE.md'), 'utf-8')).toContain(
        'always refer to `.agentteams/convention.md`',
      );
      expect(readFileSync(join(repoDir, 'AGENTS.md'), 'utf-8')).toContain(
        'always refer to `.agentteams/convention.md`',
      );
      const hookLines = readFileSync(join(repoDir, '.git', 'hooks', 'post-checkout'), 'utf-8').split('\n');
      expect(hookLines[0]).toBe('#!/bin/sh');
      expect(hookLines[1]).toContain('AgentTeams managed post-checkout hook');
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf-8' });
      expect(status.trim()).toBe('');
    }

    const second = await executeDoctorCommand({ cwd: nestedCwd });
    expect(second.status).toBe('READY');
    expect(second.changedCount).toBe(0);
    expect(second.repositories.map((repo) => ({ ...repo, changedCount: 0 }))).toEqual(
      first.repositories.map((repo) => ({ ...repo, changedCount: 0 })),
    );
  });

  it('never leaks the API key or config body into the result', async () => {
    const rootDir = createRoot();
    addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(JSON.stringify(result)).not.toContain('secret-api-key-1');
    expect(JSON.stringify(result)).not.toContain('team-1');
  });

  it('preserves custom hooks, hooksPath setups, and occupied or wrong links, reporting DEGRADED', async () => {
    const rootDir = createRoot();

    const customHookDir = addMemberRepo(rootDir, 'custom-hook');
    const customHookPath = join(customHookDir, '.git', 'hooks', 'post-checkout');
    const customHookContent = '#!/bin/sh\necho custom\n';
    writeFileSync(customHookPath, customHookContent, { encoding: 'utf-8', mode: 0o755 });

    const hooksPathDir = addMemberRepo(rootDir, 'hooks-path');
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: hooksPathDir });

    const occupiedDir = addMemberRepo(rootDir, 'occupied');
    mkdirSync(join(occupiedDir, '.agentteams'));
    writeFileSync(join(occupiedDir, '.agentteams', 'marker.txt'), 'keep me\n', 'utf-8');

    const wrongTargetDir = addMemberRepo(rootDir, 'wrong-target');
    const otherTarget = join(createTempDir(), 'other');
    mkdirSync(otherTarget, { recursive: true });
    symlinkSync(otherTarget, join(wrongTargetDir, '.agentteams'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');

    const byName = new Map(result.repositories.map((repo) => [repo.path, repo]));
    const canonical = (path: string): string => canonicalizePath(path);

    const customHookRepo = byName.get(canonical(customHookDir))!;
    expect(customHookRepo.status).toBe('DEGRADED');
    expect(customHookRepo.hook).toBe('blocked');
    expect(customHookRepo.issues.map((issue) => issue.code)).toContain('hook-custom');
    expect(readFileSync(customHookPath, 'utf-8')).toBe(customHookContent);

    const hooksPathRepo = byName.get(canonical(hooksPathDir))!;
    expect(hooksPathRepo.status).toBe('DEGRADED');
    expect(hooksPathRepo.issues.map((issue) => issue.code)).toContain('hook-hookspath');

    const occupiedRepo = byName.get(canonical(occupiedDir))!;
    expect(occupiedRepo.status).toBe('DEGRADED');
    expect(occupiedRepo.link).toBe('occupied');
    expect(occupiedRepo.hook).toBe('skipped');
    expect(occupiedRepo.issues.map((issue) => issue.code)).toContain('link-occupied');
    expect(readFileSync(join(occupiedDir, '.agentteams', 'marker.txt'), 'utf-8')).toBe('keep me\n');
    expect(existsSync(join(occupiedDir, '.git', 'hooks', 'post-checkout'))).toBe(false);

    const wrongTargetRepo = byName.get(canonical(wrongTargetDir))!;
    expect(wrongTargetRepo.status).toBe('DEGRADED');
    expect(wrongTargetRepo.link).toBe('wrong-target');
    expect(wrongTargetRepo.issues.map((issue) => issue.code)).toContain('link-wrong-target');
    expect(realpathSync(join(wrongTargetDir, '.agentteams'))).toBe(realpathSync(otherTarget));
  });

  it('reports tracked and existing entry point conflicts without modifying the files', async () => {
    const rootDir = createRoot();
    const memberDir = addMemberRepo(rootDir, 'conflicted');

    const trackedContent = '# Member-owned CLAUDE guide\n';
    writeFileSync(join(memberDir, 'CLAUDE.md'), trackedContent, 'utf-8');
    execFileSync('git', ['add', 'CLAUDE.md'], { cwd: memberDir });
    execFileSync(
      'git',
      ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'track claude'],
      { cwd: memberDir },
    );

    const existingContent = '# Untracked member AGENTS notes\n';
    writeFileSync(join(memberDir, 'AGENTS.md'), existingContent, 'utf-8');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    const repo = result.repositories[0];
    expect(repo.entryPointConflicts).toEqual([
      { relativePath: 'CLAUDE.md', state: 'tracked' },
      { relativePath: 'AGENTS.md', state: 'existing' },
    ]);
    expect(repo.issues.map((issue) => issue.code)).toContain('entry-point-conflict');
    expect(readFileSync(join(memberDir, 'CLAUDE.md'), 'utf-8')).toBe(trackedContent);
    expect(readFileSync(join(memberDir, 'AGENTS.md'), 'utf-8')).toBe(existingContent);
  });

  it('reports missing recommended entry points as DEGRADED without creating root files', async () => {
    const rootDir = createRoot({ entryPoints: ['GEMINI.md'] });
    addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.rootEntryPoints).toEqual(['GEMINI.md']);
    expect(result.missingRecommendedEntryPoints).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(result.issues.map((issue) => issue.code)).toContain('missing-recommended-entry-point');
    expect(existsSync(join(rootDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(rootDir, 'AGENTS.md'))).toBe(false);
  });

  it('includes the daemon worktree limitation as an informational issue that does not lower readiness', async () => {
    const rootDir = createRoot();
    addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('READY');
    const info = result.issues.find((issue) => issue.code === 'daemon-worktree-unsupported');
    expect(info?.severity).toBe('info');
  });
});

describe('doctor root preflight failures', () => {
  it('changes nothing when the root config is incomplete', async () => {
    const rootDir = createRoot({ configBody: JSON.stringify({ teamId: 'team-1' }) });
    const memberDir = addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.changedCount).toBe(0);
    expect(result.repositories).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain('root-config-incomplete');
    expect(existsSync(join(memberDir, '.agentteams'))).toBe(false);
    expect(existsSync(join(memberDir, '.git', 'hooks', 'post-checkout'))).toBe(false);
  });

  it('changes nothing when the root config is not valid JSON', async () => {
    const rootDir = createRoot({ configBody: 'not-json' });
    const memberDir = addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.changedCount).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toContain('root-config-invalid');
    expect(existsSync(join(memberDir, '.agentteams'))).toBe(false);
  });

  it('changes nothing when the root convention file is missing', async () => {
    const rootDir = createRoot({ skipConvention: true });
    const memberDir = addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.changedCount).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toContain('root-convention-missing');
    expect(existsSync(join(memberDir, '.agentteams'))).toBe(false);
  });

  it('changes nothing when the root convention path is not a readable regular file', async () => {
    const rootDir = createRoot({ skipConvention: true });
    const memberDir = addMemberRepo(rootDir, 'alpha');
    mkdirSync(join(rootDir, '.agentteams', 'convention.md'));

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.changedCount).toBe(0);
    expect(result.repositories).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain('root-convention-invalid');
    expect(existsSync(join(memberDir, '.agentteams'))).toBe(false);
  });

  // The default `agentteams init` stores no key in the repository — the credential
  // lives in the OS credential store — so demanding `apiKey` here would fail
  // preflight for every project on the default auth path and skip the repair work
  // entirely.
  it('accepts a personal-login root config that stores no apiKey', async () => {
    const rootDir = createRoot({
      configBody: JSON.stringify({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' }),
    });
    const memberDir = addMemberRepo(rootDir, 'alpha');

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('READY');
    expect(result.issues.map((issue) => issue.code)).not.toContain('root-config-incomplete');
    expect(existsSync(join(memberDir, '.agentteams'))).toBe(true);
  });

  it('still requires apiKey when the project did not opt into a personal login', async () => {
    const rootDir = createRoot({ configBody: JSON.stringify({ teamId: 'team-1', projectId: 'project-1' }) });

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.issues.map((issue) => issue.code)).toContain('root-config-incomplete');
  });

  it('rejects non-file root entry points instead of reporting READY', async () => {
    const rootDir = createRoot();
    const memberDir = addMemberRepo(rootDir, 'alpha');
    rmSync(join(rootDir, 'CLAUDE.md'));
    mkdirSync(join(rootDir, 'CLAUDE.md'));

    const result = await executeDoctorCommand({ cwd: rootDir });

    expect(result.status).toBe('DEGRADED');
    expect(result.rootEntryPoints).toEqual(['AGENTS.md']);
    expect(result.issues.map((issue) => issue.code)).toContain('root-entry-point-invalid');
    expect(existsSync(join(memberDir, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(memberDir, 'AGENTS.md'), 'utf-8')).toContain(
      'always refer to `.agentteams/convention.md`',
    );
  });
});

function createGitRootProject(options?: { configBody?: string }): string {
  const repoDir = join(createTempDir(), 'repo');
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
  writeFileSync(join(repoDir, 'README.md'), '# repo\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync(
    'git',
    ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
    { cwd: repoDir },
  );
  mkdirSync(join(repoDir, '.agentteams'), { recursive: true });
  writeFileSync(
    join(repoDir, '.agentteams', 'config.json'),
    options?.configBody ?? JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiKey: 'api-key-1' }),
    { encoding: 'utf-8', mode: CONFIG_FILE_MODE },
  );
  writeFileSync(join(repoDir, '.agentteams', 'convention.md'), '# Root convention\n', 'utf-8');
  return repoDir;
}

describe('doctor on a git root project', () => {
  // A git root project has no member repos, so the doctor's only job here is
  // the worktree bootstrap hook. Without it the hook can only be installed by
  // re-running the interactive OAuth init, which leaves existing projects
  // permanently without worktree convention bootstrap.
  it('installs the worktree bootstrap hook and reports zero changes on the second run', async () => {
    const repoDir = createGitRootProject();

    const first = await executeDoctorCommand({ cwd: repoDir });

    expect(first.applicable).toBe(true);
    expect(first.layout).toBe('git-root');
    expect(first.status).toBe('READY');
    expect(first.changedCount).toBeGreaterThan(0);
    const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
    expect(existsSync(hookPath)).toBe(true);
    expect(readFileSync(hookPath, 'utf-8').split(/\r?\n/)[1]).toBe('# AgentTeams managed post-checkout hook');

    const second = await executeDoctorCommand({ cwd: repoDir });

    expect(second.status).toBe('READY');
    expect(second.changedCount).toBe(0);
  });

  // `init`'s configured-project fast path reports `local-adapters` straight from
  // this result. A preflight that rejects the default (keyless) config would make
  // that step permanently DEGRADED and leave the hook uninstalled.
  it('installs the worktree bootstrap hook for a personal-login project without an apiKey', async () => {
    const repoDir = createGitRootProject({
      configBody: JSON.stringify({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' }),
    });

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(result.status).toBe('READY');
    expect(result.rootHook).toBe('ready');
    expect(result.issues.map((issue) => issue.code)).not.toContain('root-config-incomplete');
    expect(existsSync(join(repoDir, '.git', 'hooks', 'post-checkout'))).toBe(true);
  });

  it('leaves member repo management alone for a git root project', async () => {
    const repoDir = createGitRootProject();
    const excludeBefore = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf-8');

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(result.repositories).toEqual([]);
    expect(readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf-8')).toBe(excludeBefore);
    expect(lstatSync(join(repoDir, '.agentteams')).isDirectory()).toBe(true);
  });

  // A user's own hook infrastructure is not a project defect: the doctor
  // reports the manual fallback and keeps the exit code a git root project has
  // always returned, so scripts and CI that call it do not turn permanently red.
  it('never overwrites an unmanaged post-checkout hook and still exits 0', async () => {
    const repoDir = createGitRootProject();
    const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
    const customHook = '#!/bin/sh\n# my own hook\nexit 0\n';
    writeFileSync(hookPath, customHook, 'utf-8');

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(readFileSync(hookPath, 'utf-8')).toBe(customHook);
    expect(result.status).toBe('READY');
    expect(result.rootHook).toBe('blocked');
    expect(resolveDoctorExitCode(result)).toBe(0);
    const issue = result.issues.find((candidate) => candidate.code === 'hook-custom');
    expect(issue?.severity).toBe('info');
    expect(issue?.message).toContain('agentteams init');
  });

  it('exits 0 and points at the manual fallback when core.hooksPath is user managed', async () => {
    const repoDir = createGitRootProject();
    const customHooksDir = join(repoDir, '.husky');
    mkdirSync(customHooksDir);
    execFileSync('git', ['config', 'core.hooksPath', customHooksDir], { cwd: repoDir });

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(result.status).toBe('READY');
    expect(result.rootHook).toBe('blocked');
    expect(resolveDoctorExitCode(result)).toBe(0);
    expect(result.issues.find((candidate) => candidate.code === 'hook-hookspath')?.severity).toBe('info');
    expect(existsSync(join(repoDir, '.git', 'hooks', 'post-checkout'))).toBe(false);
    expect(existsSync(join(customHooksDir, 'post-checkout'))).toBe(false);
  });

  // core.hooksPath set to the directory git would have used anyway — spelling
  // the default out changes nothing about where hooks run, so refusing the
  // install would deny the feature for no reason. This repository itself has
  // that configuration.
  it('installs the hook when core.hooksPath is the default hooks directory', async () => {
    const repoDir = createGitRootProject();
    const hookPath = join(repoDir, '.git', 'hooks', 'post-checkout');
    execFileSync('git', ['config', 'core.hooksPath', join(repoDir, '.git', 'hooks')], { cwd: repoDir });

    const absolute = await executeDoctorCommand({ cwd: repoDir });

    expect(absolute.status).toBe('READY');
    expect(absolute.rootHook).toBe('ready');
    expect(readFileSync(hookPath, 'utf-8').split(/\r?\n/)[1]).toBe('# AgentTeams managed post-checkout hook');

    rmSync(hookPath);
    execFileSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: repoDir });

    const relative = await executeDoctorCommand({ cwd: repoDir });

    expect(relative.status).toBe('READY');
    expect(relative.rootHook).toBe('ready');
    expect(existsSync(hookPath)).toBe(true);
  });

  it('reports the git root layout when the diagnosis stops at preflight', async () => {
    const repoDir = createGitRootProject();
    writeFileSync(join(repoDir, '.agentteams', 'config.json'), 'not json', 'utf-8');

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(result.layout).toBe('git-root');
    expect(result.status).toBe('DEGRADED');
    expect(result.rootHook).toBe('skipped');
    expect(result.issues.map((issue) => issue.code)).toContain('root-config-invalid');
  });
});

describe('doctor config file permissions', () => {
  // POSIX permission bits are the thing under test; Windows has no equivalent.
  const posixIt = process.platform === 'win32' ? it.skip : it;

  posixIt('narrows a world-readable config written before saveConfig enforced 0600', async () => {
    const repoDir = createGitRootProject();
    const configPath = join(repoDir, '.agentteams', 'config.json');
    chmodSync(configPath, 0o644);

    const result = await executeDoctorCommand({ cwd: repoDir });

    const issue = result.issues.find((candidate) => candidate.code === 'config-permissions-narrowed');
    expect(isSamePath(issue!.path!, configPath)).toBe(true);
    expect(issue?.severity).toBe('info');
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    // A repairable permission is not a broken project.
    expect(result.status).toBe('READY');
    expect(resolveDoctorExitCode(result)).toBe(0);
  });

  posixIt('also narrows a leftover config backup holding the same key', async () => {
    const repoDir = createGitRootProject();
    const backupPath = join(repoDir, '.agentteams', 'config.json.agentteams-backup');
    writeFileSync(backupPath, '{"apiKey":"secret-api-key-1"}', { encoding: 'utf-8', mode: 0o600 });
    chmodSync(backupPath, 0o644);

    const result = await executeDoctorCommand({ cwd: repoDir });

    const narrowed = result.issues.filter((issue) => issue.code === 'config-permissions-narrowed');
    expect(narrowed).toHaveLength(1);
    expect(isSamePath(narrowed[0].path!, backupPath)).toBe(true);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
  });

  posixIt('reports nothing and changes nothing when the config is already owner-only', async () => {
    const repoDir = createGitRootProject();

    const first = await executeDoctorCommand({ cwd: repoDir });
    const second = await executeDoctorCommand({ cwd: repoDir });

    expect(first.issues.map((issue) => issue.code)).not.toContain('config-permissions-narrowed');
    expect(second.changedCount).toBe(0);
  });

  posixIt('still repairs permissions when the layout diagnosis stops at preflight', async () => {
    const repoDir = createGitRootProject();
    const configPath = join(repoDir, '.agentteams', 'config.json');
    writeFileSync(configPath, 'not json', { encoding: 'utf-8', mode: 0o644 });
    chmodSync(configPath, 0o644);

    const result = await executeDoctorCommand({ cwd: repoDir });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['root-config-invalid', 'config-permissions-narrowed']),
    );
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(result.status).toBe('DEGRADED');
  });
});

describe('doctor on non-applicable layouts', () => {
  it('returns NOT_APPLICABLE when no project config exists', async () => {
    const plainDir = createTempDir();

    const result = await executeDoctorCommand({ cwd: plainDir });

    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.rootDir).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain('no-project-config');
  });
});
