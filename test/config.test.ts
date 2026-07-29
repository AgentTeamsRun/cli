import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CONFIG_FILE_MODE,
  findProjectConfig,
  getConfigurationNotFoundMessage,
  saveConfig,
  saveLegacyApiKeyConfig,
  type PersistedConfig,
} from '../src/utils/config.js';
import { canonicalizePath } from '../src/utils/path.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-config-test-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeConfig(configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '{}\n', 'utf-8');
}

function createRepository(rootDir: string): string {
  const repositoryDir = join(rootDir, 'main');
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
  return repositoryDir;
}

function createLinkedWorktree(repositoryDir: string, worktreeDir: string): void {
  mkdirSync(dirname(worktreeDir), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', `test-${Date.now()}`, worktreeDir], { cwd: repositoryDir });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('findProjectConfig', () => {
  it('returns the nearest ancestor config outside a git repository', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, 'project', '.agentteams', 'config.json');
    const nestedDir = join(tempDir, 'project', 'packages', 'cli');
    writeConfig(configPath);
    mkdirSync(nestedDir, { recursive: true });

    expect(findProjectConfig(nestedDir)).toBe(configPath);
  });

  it('returns null when no ancestor contains a config', () => {
    const tempDir = createTempDir();
    const nestedDir = join(tempDir, 'project', 'packages', 'cli');
    mkdirSync(nestedDir, { recursive: true });

    expect(findProjectConfig(nestedDir)).toBeNull();
  });

  it('uses the main checkout config instead of an unrelated ancestor config for a linked worktree', () => {
    const tempDir = createTempDir();
    const repositoryDir = createRepository(tempDir);
    const mainConfigPath = join(canonicalizePath(repositoryDir), '.agentteams', 'config.json');
    const unrelatedConfigPath = join(tempDir, 'fake-home', '.agentteams', 'config.json');
    const worktreeDir = join(tempDir, 'fake-home', 'workspaces', 'linked');
    writeConfig(mainConfigPath);
    writeConfig(unrelatedConfigPath);
    createLinkedWorktree(repositoryDir, worktreeDir);

    expect(findProjectConfig(worktreeDir)).toBe(mainConfigPath);
  });

  it('uses the main checkout config when a linked worktree has no config in its ancestors', () => {
    const tempDir = createTempDir();
    const repositoryDir = createRepository(tempDir);
    const mainConfigPath = join(canonicalizePath(repositoryDir), '.agentteams', 'config.json');
    const worktreeDir = join(tempDir, 'worktrees', 'linked');
    writeConfig(mainConfigPath);
    createLinkedWorktree(repositoryDir, worktreeDir);

    expect(findProjectConfig(worktreeDir)).toBe(mainConfigPath);
  });

  it('does not cross the repository boundary to use an unrelated ancestor config', () => {
    const tempDir = createTempDir();
    const unrelatedConfigPath = join(tempDir, '.agentteams', 'config.json');
    const repositoryDir = createRepository(tempDir);
    writeConfig(unrelatedConfigPath);

    expect(findProjectConfig(repositoryDir)).toBeNull();
  });
});

describe('saveConfig', () => {
  const persisted = { teamId: 'team-1', projectId: 'project-1', apiUrl: 'https://api.agentteams.run' };

  it('keeps apiKey out of the persisted config type', () => {
    const typecheckProof: 'apiKey' extends keyof PersistedConfig ? false : true = true;

    expect(typecheckProof).toBe(true);
  });

  // POSIX permission bits are the thing under test; Windows has no equivalent.
  const posixIt = process.platform === 'win32' ? it.skip : it;
  // Root ignores the mode bits the read-only directory case relies on.
  const unprivilegedIt = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;

  posixIt('writes a new config file with owner-only permissions', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, '.agentteams', 'config.json');

    saveConfig(configPath, persisted);

    expect(statSync(configPath).mode & 0o777).toBe(CONFIG_FILE_MODE);
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(persisted);
    expect(readFileSync(configPath, 'utf-8')).not.toContain('key_');
  });

  posixIt('narrows an existing world-readable config to owner-only when it rewrites it', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, '.agentteams', 'config.json');
    writeConfig(configPath);
    chmodSync(configPath, 0o644);

    saveConfig(configPath, persisted);

    expect(statSync(configPath).mode & 0o777).toBe(CONFIG_FILE_MODE);
  });

  it('leaves no temporary file behind on success', () => {
    const tempDir = createTempDir();
    const configDir = join(tempDir, '.agentteams');
    saveConfig(join(configDir, 'config.json'), persisted);

    expect(readdirSync(configDir)).toEqual(['config.json']);
  });

  unprivilegedIt('does not truncate the existing config when the write fails', () => {
    const tempDir = createTempDir();
    const configDir = join(tempDir, '.agentteams');
    const configPath = join(configDir, 'config.json');
    writeConfig(configPath);
    const original = readFileSync(configPath, 'utf-8');
    // A read-only directory blocks the temp file and the rename, but not an
    // in-place `writeFileSync` on the already-existing target.
    chmodSync(configDir, 0o500);

    try {
      expect(() => saveConfig(configPath, persisted)).toThrow();
      expect(readFileSync(configPath, 'utf-8')).toBe(original);
      expect(readdirSync(configDir)).toEqual(['config.json']);
    } finally {
      chmodSync(configDir, 0o700);
    }
  });

  it('keeps legacy api-key persistence behind an explicit compatibility helper', () => {
    const tempDir = createTempDir();
    const configPath = join(tempDir, '.agentteams', 'config.json');
    const legacy = { teamId: 'team-1', projectId: 'project-1', apiKey: 'key_secret' };

    saveLegacyApiKeyConfig(configPath, legacy);

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual(legacy);
  });
});

describe('getConfigurationNotFoundMessage', () => {
  const defaultMessage =
    "Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.";

  it('adds a doctor hint when a member repository is below a configured non-git workspace', () => {
    const workspaceDir = createTempDir();
    writeConfig(join(workspaceDir, '.agentteams', 'config.json'));
    const repositoryDir = createRepository(workspaceDir);

    expect(getConfigurationNotFoundMessage(repositoryDir)).toBe(
      `${defaultMessage} A parent workspace config was found outside this repository. Run 'agentteams doctor' from the workspace root to materialize .agentteams.`,
    );
  });

  it('keeps the existing message when no configured non-git workspace exists', () => {
    const tempDir = createTempDir();
    const repositoryDir = createRepository(tempDir);

    expect(getConfigurationNotFoundMessage(repositoryDir)).toBe(defaultMessage);
  });

  it('does not treat the global config as a parent workspace config when home is symlinked', () => {
    const tempDir = createTempDir();
    const physicalHome = join(tempDir, 'physical-home');
    const symbolicHome = join(tempDir, 'symbolic-home');
    const workspaceDir = join(physicalHome, 'workspace');
    mkdirSync(physicalHome, { recursive: true });
    // Windows directory junctions exercise the same realpath boundary without requiring
    // Developer Mode or elevated symlink privileges.
    symlinkSync(physicalHome, symbolicHome, process.platform === 'win32' ? 'junction' : 'dir');
    writeConfig(join(physicalHome, '.agentteams', 'config.json'));
    const repositoryDir = createRepository(workspaceDir);
    expect(getConfigurationNotFoundMessage(repositoryDir, symbolicHome)).toBe(defaultMessage);
  });
});
