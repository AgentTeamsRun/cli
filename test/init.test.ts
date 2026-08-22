import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapLinkedWorktree,
  buildAuthorizeUrl,
  detectInitExecutionContext,
  detectOsType,
  executeInitCommand,
  type WorktreeInitResult,
} from '../src/commands/init.js';
import { detectAgentEntryPointFiles, parseAgentFilesOption } from '../src/utils/agentEntryPoints.js';
import { hasLinkedGitWorktrees } from '../src/utils/git.js';
import { isSamePath } from '../src/utils/path.js';

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
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiUrl: 'https://api.agentteams.run' }),
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
    JSON.stringify({ teamId: 'team-1', projectId: 'project-1', apiUrl: 'https://api.agentteams.run' }),
    'utf-8',
  );
  writeFileSync(join(rootDir, '.agentteams', 'convention.md'), '# Root convention\n', 'utf-8');
  writeFileSync(join(rootDir, 'CLAUDE.md'), '# Root CLAUDE entry point\n', 'utf-8');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Root AGENTS entry point\n', 'utf-8');

  const memberDir = join(rootDir, 'member');
  mkdirSync(memberDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: memberDir });
  // Byte-for-byte assertions on checked-out files only hold when git is not
  // rewriting line endings; a Windows host with core.autocrlf=true otherwise
  // turns the fixture's LF content into CRLF behind the test's back.
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: memberDir });
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

/**
 * A materialized worktree must carry a real link, never a copy. Windows
 * junctions and POSIX directory symlinks both report as symbolic links, so the
 * same assertions hold on every platform — a copy fallback here means the
 * worktree silently stopped tracking the main checkout's conventions.
 */
function expectMaterializedConfig(result: WorktreeInitResult, worktreeDir: string, repositoryDir: string): void {
  const targetPath = join(worktreeDir, '.agentteams');
  const sourcePath = join(repositoryDir, '.agentteams');

  expect(result).toMatchObject({ mode: 'worktree', materialization: 'symlink' });
  expect(result.warning).toBeUndefined();
  expect(readFileSync(join(targetPath, 'convention.md'), 'utf-8')).toBe('# Convention chain restored\n');
  expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
  expect(isSamePath(targetPath, sourcePath)).toBe(true);
}

/**
 * The sync guarantee a copy fallback breaks: an edit in the main checkout has
 * to be visible through the worktree entry immediately.
 */
function expectConventionEditPropagates(worktreeDir: string, repositoryDir: string): void {
  const updated = '# Convention updated in the main checkout\n';
  writeFileSync(join(repositoryDir, '.agentteams', 'convention.md'), updated, 'utf-8');
  expect(readFileSync(join(worktreeDir, '.agentteams', 'convention.md'), 'utf-8')).toBe(updated);
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('init helpers', () => {
  test('detectInitExecutionContext classifies linked worktree, configured project, and new project without writes', () => {
    const originalApiKey = process.env.AGENTTEAMS_API_KEY;
    delete process.env.AGENTTEAMS_API_KEY;
    const { worktreeDir } = createRepository();
    const configuredDir = mkdtempSync(join(tmpdir(), 'agentteams-init-configured-test-'));
    const newProjectDir = mkdtempSync(join(tmpdir(), 'agentteams-init-new-test-'));
    tempDirs.push(configuredDir, newProjectDir);
    mkdirSync(join(configuredDir, '.agentteams'), { recursive: true });
    writeFileSync(
      join(configuredDir, '.agentteams', 'config.json'),
      JSON.stringify({
        teamId: 'team-1',
        projectId: 'project-1',
        apiUrl: 'https://api.agentteams.run',
        authMode: 'personal-token',
      }),
      'utf-8',
    );

    const beforeWorktree = readdirSync(worktreeDir, { recursive: true }).map(String).sort();
    const beforeConfigured = readdirSync(configuredDir, { recursive: true }).map(String).sort();
    const beforeNewProject = readdirSync(newProjectDir, { recursive: true }).map(String).sort();

    try {
      expect(detectInitExecutionContext(worktreeDir)).toMatchObject({ kind: 'linked-worktree' });
      expect(detectInitExecutionContext(configuredDir)).toMatchObject({ kind: 'configured-project' });
      expect(detectInitExecutionContext(newProjectDir)).toMatchObject({ kind: 'new-project' });

      expect(readdirSync(worktreeDir, { recursive: true }).map(String).sort()).toEqual(beforeWorktree);
      expect(readdirSync(configuredDir, { recursive: true }).map(String).sort()).toEqual(beforeConfigured);
      expect(readdirSync(newProjectDir, { recursive: true }).map(String).sort()).toEqual(beforeNewProject);
    } finally {
      if (originalApiKey === undefined) delete process.env.AGENTTEAMS_API_KEY;
      else process.env.AGENTTEAMS_API_KEY = originalApiKey;
    }
  });

  test('detectInitExecutionContext treats an explicit auth mode as a relink request', () => {
    const configuredDir = mkdtempSync(join(tmpdir(), 'agentteams-init-relink-test-'));
    tempDirs.push(configuredDir);
    mkdirSync(join(configuredDir, '.agentteams'), { recursive: true });
    writeFileSync(
      join(configuredDir, '.agentteams', 'config.json'),
      JSON.stringify({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' }),
      'utf-8',
    );

    expect(detectInitExecutionContext(configuredDir, 'api-key')).toMatchObject({ kind: 'new-project' });
  });

  test('detectInitExecutionContext never reuses an ancestor or global binding for a new folder', () => {
    const ancestorDir = mkdtempSync(join(tmpdir(), 'agentteams-init-ancestor-test-'));
    tempDirs.push(ancestorDir);
    mkdirSync(join(ancestorDir, '.agentteams'), { recursive: true });
    writeFileSync(
      join(ancestorDir, '.agentteams', 'config.json'),
      JSON.stringify({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' }),
      'utf-8',
    );
    const childDir = join(ancestorDir, 'new-folder');
    mkdirSync(childDir, { recursive: true });

    // A plain subfolder of a configured workspace is a new project: init writes
    // its config into cwd, so classification must use the same scope.
    expect(detectInitExecutionContext(childDir)).toMatchObject({ kind: 'new-project' });

    // The same ancestor walk reaches ~/.agentteams/config.json, which is a
    // command-level fallback and never a project binding.
    expect(detectInitExecutionContext(childDir, undefined, ancestorDir)).toMatchObject({ kind: 'new-project' });
    expect(detectInitExecutionContext(ancestorDir, undefined, ancestorDir)).toMatchObject({ kind: 'new-project' });
  });

  testPosix('detectInitExecutionContext keeps a configured repository subdirectory on the fast path', () => {
    const { repositoryDir } = createRepository();
    const packageDir = join(repositoryDir, 'packages', 'app');
    mkdirSync(packageDir, { recursive: true });

    // Repository-scoped lookup: every other command resolves the repository root
    // config from a subdirectory, so init validating that same binding — instead
    // of creating a nested project — is the consistent answer.
    expect(detectInitExecutionContext(packageDir)).toMatchObject({ kind: 'configured-project' });
  });

  test('buildAuthorizeUrl includes authPathEnc and osType when provided', () => {
    const url = buildAuthorizeUrl({ port: 9876, projectName: 'demo', authPathEnc: 'enc-value', osType: 'LINUX' });
    const parsed = new URL(url);

    expect(parsed.searchParams.get('port')).toBe('9876');
    expect(parsed.searchParams.get('projectName')).toBe('demo');
    expect(parsed.searchParams.get('ap')).toBe('enc-value');
    expect(parsed.searchParams.get('ot')).toBe('LINUX');
    expect(parsed.searchParams.has('state')).toBe(false);
  });

  test('buildAuthorizeUrl carries the login state so the web page can echo it back', () => {
    const url = buildAuthorizeUrl({ port: 9876, projectName: 'demo', state: 'state-token' });

    expect(new URL(url).searchParams.get('state')).toBe('state-token');
  });

  test('buildAuthorizeUrl carries the machine id so the server can bind this machine runner', () => {
    const url = buildAuthorizeUrl({ port: 9876, projectName: 'demo', machineId: 'machine-1' });

    expect(new URL(url).searchParams.get('mid')).toBe('machine-1');
  });

  test('buildAuthorizeUrl omits the machine id when it could not be resolved', () => {
    const url = buildAuthorizeUrl({
      port: 9876,
      projectName: 'demo',
      authPathEnc: 'enc-value',
      osType: 'LINUX',
      state: 'state-token',
    });

    expect(new URL(url).searchParams.has('mid')).toBe(false);
  });

  test('buildAuthorizeUrl asks for the unified setup screen only when a PKCE challenge is present', () => {
    const setupUrl = new URL(
      buildAuthorizeUrl({ port: 9876, projectName: 'demo', state: 'state-token', codeChallenge: 'challenge-value' }),
    );

    expect(setupUrl.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(setupUrl.searchParams.get('flow')).toBe('setup');

    // --auth api-key는 통합 화면을 요청하지 않는다. 구/신 web 모두 레거시 폼으로 떨어져야 한다.
    const legacyUrl = new URL(buildAuthorizeUrl({ port: 9876, projectName: 'demo', state: 'state-token' }));

    expect(legacyUrl.searchParams.has('code_challenge')).toBe(false);
    expect(legacyUrl.searchParams.has('flow')).toBe(false);
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

describe('agent entry point selection inputs', () => {
  function createDetectionDir(markers: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'agentteams-init-detect-test-'));
    tempDirs.push(dir);
    for (const marker of markers) {
      mkdirSync(join(dir, marker), { recursive: true });
    }
    return dir;
  }

  // A repository created or cloned minutes ago has no `.claude/` yet — it appears
  // only once the user approves project scope — so marker-only detection selected
  // nothing exactly where a first `init` runs. Falling back to one file keeps a
  // path from an agent to `.agentteams/convention.md`.
  test('falls back to CLAUDE.md in a folder with no AI client signal', () => {
    expect(detectAgentEntryPointFiles(createDetectionDir([]))).toEqual(['CLAUDE.md']);
  });

  test('detects each client from its own configuration directory', () => {
    expect(detectAgentEntryPointFiles(createDetectionDir(['.claude']))).toEqual(['CLAUDE.md']);
    expect(detectAgentEntryPointFiles(createDetectionDir(['.codex']))).toEqual(['AGENTS.md']);
    expect(detectAgentEntryPointFiles(createDetectionDir(['.opencode']))).toEqual(['AGENTS.md']);
    expect(detectAgentEntryPointFiles(createDetectionDir(['.cursor']))).toEqual(['.cursor/rules/agentteams.mdc']);
    expect(detectAgentEntryPointFiles(createDetectionDir(['.claude', '.gemini']))).toEqual(['CLAUDE.md', 'GEMINI.md']);
  });

  // Verified 2026-08-08 with kiro-cli 2.16.2: it reads AGENTS.md and ignores
  // CLAUDE.md. Without the marker a Kiro-only repository fell through to the
  // CLAUDE.md fallback, so init produced a file Kiro never opens and the runner
  // had no path to `.agentteams/convention.md`.
  test('a Kiro-only repository selects AGENTS.md rather than the CLAUDE.md fallback', () => {
    expect(detectAgentEntryPointFiles(createDetectionDir(['.kiro']))).toEqual(['AGENTS.md']);
    expect(detectAgentEntryPointFiles(createDetectionDir(['.kimi-code']))).toEqual(['AGENTS.md']);
  });

  // An existing entry point never produces a write — init leaves it alone — but
  // it does say which client the folder uses, and the adapters downstream act on
  // that: a hand-written GEMINI.md is what makes `.geminiignore` applicable.
  test('an existing entry point file counts as a client signal', () => {
    const dir = createDetectionDir([]);
    writeFileSync(join(dir, 'GEMINI.md'), '# mine\n', 'utf-8');

    expect(detectAgentEntryPointFiles(dir)).toEqual(['GEMINI.md']);
  });

  test('parseAgentFilesOption tells "no choice" apart from "create nothing"', () => {
    expect(parseAgentFilesOption(undefined)).toBeNull();
    expect(parseAgentFilesOption('')).toBeNull();
    expect(parseAgentFilesOption('none')).toEqual([]);
    expect(parseAgentFilesOption('CLAUDE.md, AGENTS.md')).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(parseAgentFilesOption('CLAUDE.md,CLAUDE.md')).toEqual(['CLAUDE.md']);
  });

  test('parseAgentFilesOption rejects an unknown value instead of dropping it', () => {
    expect(() => parseAgentFilesOption('CLAUDE.txt')).toThrow(/Unknown --agent-files value/);
    expect(() => parseAgentFilesOption('none,CLAUDE.md')).toThrow(/cannot be combined/);
  });

  test('hasLinkedGitWorktrees separates a plain repository from one with worktrees', () => {
    const { repositoryDir, worktreeDir } = createRepository();

    expect(hasLinkedGitWorktrees(repositoryDir)).toBe(true);
    expect(hasLinkedGitWorktrees(worktreeDir)).toBe(true);

    const plainRepositoryDir = mkdtempSync(join(tmpdir(), 'agentteams-init-plain-repo-test-'));
    tempDirs.push(plainRepositoryDir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: plainRepositoryDir });

    expect(hasLinkedGitWorktrees(plainRepositoryDir)).toBe(false);

    // A directory that is not a repository at all must not read as "in use".
    const nonRepositoryDir = mkdtempSync(join(tmpdir(), 'agentteams-init-nonrepo-test-'));
    tempDirs.push(nonRepositoryDir);
    expect(hasLinkedGitWorktrees(nonRepositoryDir)).toBe(false);
  });

  // `git worktree list --porcelain` keeps reporting a worktree whose directory is
  // gone until `git worktree prune` runs, marking the record `prunable`. Counting
  // records alone therefore claimed a repository still used worktrees after the
  // last one had been deleted.
  test('hasLinkedGitWorktrees ignores a prunable worktree record', () => {
    const { repositoryDir, worktreeDir } = createRepository();

    expect(hasLinkedGitWorktrees(repositoryDir)).toBe(true);

    rmSync(worktreeDir, { recursive: true, force: true });

    expect(
      execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repositoryDir, encoding: 'utf-8' }),
    ).toContain('prunable');
    expect(hasLinkedGitWorktrees(repositoryDir)).toBe(false);
  });
});

describe('linked worktree bootstrap', () => {
  test('init materializes the main checkout config without OAuth or prompts', async () => {
    const { repositoryDir, worktreeDir } = createRepository();

    const result = await executeInitCommand({ cwd: worktreeDir });

    expectMaterializedConfig(result as WorktreeInitResult, worktreeDir, repositoryDir);
    expectConventionEditPropagates(worktreeDir, repositoryDir);
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
    const { repositoryDir, worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    const missingTargetPath = join(worktreeDir, 'missing-agentteams');
    mkdirSync(missingTargetPath);
    symlinkSync(missingTargetPath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    rmSync(missingTargetPath, { recursive: true, force: true });

    const result = await executeInitCommand({ cwd: worktreeDir });

    expectMaterializedConfig(result as WorktreeInitResult, worktreeDir, repositoryDir);
    expect(readFileSync(join(targetPath, 'config.json'), 'utf-8')).toContain('project-1');
  });

  test('promotes a copied .agentteams directory back to a link', async () => {
    const { repositoryDir, worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    // Reproduces what a pre-fix Windows run left behind: the directory symlink
    // attempt failed with EPERM and the copy fallback wrote a plain directory,
    // which the 'existing' branch then treated as done forever.
    cpSync(join(repositoryDir, '.agentteams'), targetPath, { recursive: true });

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.materialization).toBe('relinked');
    expect(result.issues).toEqual([]);
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
    expect(isSamePath(targetPath, join(repositoryDir, '.agentteams'))).toBe(true);
    expect(readdirSync(join(repositoryDir, '.git')).filter((name) => name.startsWith('agentteams-relink'))).toEqual([]);
    expectConventionEditPropagates(worktreeDir, repositoryDir);
  });

  // A worktree that ran while it was a copy accumulates artifacts the main
  // checkout has never seen; promoting the copy back to a link must not be a
  // way to delete them.
  test('keeps files that exist only in the copied .agentteams', async () => {
    const { repositoryDir, worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    cpSync(join(repositoryDir, '.agentteams'), targetPath, { recursive: true });
    mkdirSync(join(targetPath, 'runner', 'history'), { recursive: true });
    writeFileSync(join(targetPath, 'runner', 'history', 'run-1.md'), '# run history\n', 'utf-8');
    mkdirSync(join(targetPath, 'cli', 'temp'), { recursive: true });
    writeFileSync(join(targetPath, 'cli', 'temp', 'findings.json'), '{"findings":[]}', 'utf-8');

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.materialization).toBe('relinked');
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
    const retained = result.issues.find((issue) => issue.code === 'link-backup-retained');
    expect(retained).toBeDefined();
    expect(retained!.message).toContain('2 file(s)');
    expect(readFileSync(join(retained!.path, 'runner', 'history', 'run-1.md'), 'utf-8')).toBe('# run history\n');
    expect(readFileSync(join(retained!.path, 'cli', 'temp', 'findings.json'), 'utf-8')).toBe('{"findings":[]}');
    // The promotion never writes into the main checkout's conventions.
    expect(existsSync(join(repositoryDir, '.agentteams', 'runner'))).toBe(false);
    // The backup holds a copy of the project config, so it must not surface as
    // untracked worktree state.
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDir, encoding: 'utf-8' }).trim()).toBe('');
  });

  test('never removes a .agentteams directory the user created', async () => {
    const { repositoryDir, worktreeDir } = createRepository();
    const targetPath = join(worktreeDir, '.agentteams');
    mkdirSync(targetPath);
    // Same file name as a copy would have, different content — this is the
    // user's own configuration, not a leftover copy of the main checkout.
    writeFileSync(join(targetPath, 'config.json'), JSON.stringify({ teamId: 'mine' }), 'utf-8');
    writeFileSync(join(targetPath, 'notes.md'), 'my own notes\n', 'utf-8');

    const result = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(result.materialization).toBe('existing');
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(targetPath, 'config.json'), 'utf-8')).toBe(JSON.stringify({ teamId: 'mine' }));
    expect(readFileSync(join(targetPath, 'notes.md'), 'utf-8')).toBe('my own notes\n');
    expect(result.issues.map((issue) => issue.code)).toContain('link-occupied');
    expect(existsSync(join(repositoryDir, '.agentteams', 'notes.md'))).toBe(false);
  });

  test('a promoted worktree stays stable on the next run', async () => {
    const { repositoryDir, worktreeDir } = createRepository();
    cpSync(join(repositoryDir, '.agentteams'), join(worktreeDir, '.agentteams'), { recursive: true });

    await executeInitCommand({ cwd: worktreeDir });
    const second = (await executeInitCommand({ cwd: worktreeDir })) as WorktreeInitResult;

    expect(second.materialization).toBe('existing');
    expect(lstatSync(join(worktreeDir, '.agentteams')).isSymbolicLink()).toBe(true);
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
    expect(claudeContent).toContain('**Read it once per session**, before your first substantive action.');
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
