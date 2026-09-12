import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  existsSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { BACKUP_SUFFIX } from '../src/mcp-registration/atomicWrite.js';
import { runSessionHookCommand } from '../src/commands/session.js';
import { createProgram } from '../src/program/index.js';
import { CANONICAL_CLI_NAME } from '../src/program/invokedName.js';
import { SESSION_HOOK_CLIENTS } from '../src/session-hooks/clients.js';
import { installSessionHook, SessionHookConfigError, uninstallSessionHook } from '../src/session-hooks/install.js';

const isPosix = process.platform !== 'win32';
const COMMAND = 'agentteams session sync --hook claude-code';
const CURRENT_ENTRY = SESSION_HOOK_CLIENTS[0].entry;

type SettingsWithHooks = { hooks?: { SessionStart?: { hooks?: { command?: unknown }[] }[] } };

/** 사용자가 이미 쓰고 있는 설정: 다른 SessionStart 훅, 다른 이벤트, 다른 최상위 키. */
const userSettings = () => ({
  permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] },
  hooks: {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hello', timeout: 5 }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] }],
  },
  model: 'opus',
});

const agentTeamsHooks = (settings: SettingsWithHooks): unknown[] =>
  (settings.hooks?.SessionStart ?? []).flatMap((group) =>
    (group.hooks ?? []).filter((hook) => hook.command === COMMAND),
  );

describe('session hook install/uninstall', () => {
  let cwd: string;
  let home: string;
  let projectPath: string;
  let userPath: string;

  const readSettings = (path = projectPath) => JSON.parse(readFileSync(path, 'utf8'));
  const writeSettings = (content: string, path = projectPath) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };
  const install = (options: Parameters<typeof installSessionHook>[0] = {}) =>
    installSessionHook({ cwd, homeDir: home, ...options });
  const uninstall = (options: Parameters<typeof uninstallSessionHook>[0] = {}) =>
    uninstallSessionHook({ cwd, homeDir: home, ...options });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'agentteams-session-hook-cwd-'));
    home = mkdtempSync(join(tmpdir(), 'agentteams-session-hook-home-'));
    projectPath = join(cwd, '.claude', 'settings.json');
    userPath = join(home, '.claude', 'settings.json');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the project settings file with exactly one AgentTeams entry when none exists', () => {
    const result = install();

    expect(result).toMatchObject({ status: 'installed', configPath: projectPath, backupPath: null, dryRun: false });
    expect(readSettings()).toEqual({ hooks: { SessionStart: [CURRENT_ENTRY] } });
    expect(existsSync(`${projectPath}${BACKUP_SUFFIX}`)).toBe(false);
    if (isPosix) expect(statSync(projectPath).mode & 0o777).toBe(0o644);
  });

  (isPosix ? it.each : it.skip.each)(['project', 'user'] as const)(
    'preserves a %s settings symlink through preview, install and uninstall',
    (scope) => {
      const path = scope === 'user' ? userPath : projectPath;
      const target = join(home, 'dotfiles', 'settings.json');
      const original = JSON.stringify(userSettings(), null, 2);
      writeSettings(original, target);
      mkdirSync(join(path, '..'), { recursive: true });
      symlinkSync(target, path);
      const resolvedTarget = realpathSync(target);

      expect(install({ scope, dryRun: true }).configPath).toBe(resolvedTarget);
      expect(readFileSync(target, 'utf8')).toBe(original);
      const result = install({ scope });
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
      expect(result.configPath).toBe(resolvedTarget);
      expect(result.backupPath).toBe(`${resolvedTarget}${BACKUP_SUFFIX}`);
      expect(readFileSync(result.backupPath!, 'utf8')).toBe(original);
      expect(agentTeamsHooks(readSettings(target))).toHaveLength(1);
      expect(install({ scope }).status).toBe('unchanged');
      expect(uninstall({ scope }).status).toBe('removed');
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
      expect(readSettings(target)).toEqual(userSettings());
    },
  );

  (isPosix ? it : it.skip)('refuses a dangling settings symlink without replacing it', () => {
    mkdirSync(join(projectPath, '..'), { recursive: true });
    symlinkSync(join(home, 'missing.json'), projectPath);
    expect(() => install()).toThrow(SessionHookConfigError);
    expect(() => uninstall()).toThrow(SessionHookConfigError);
    expect(lstatSync(projectPath).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, 'missing.json'))).toBe(false);
  });

  it('keeps every user hook and key, and reports unchanged on the second install', () => {
    const original = userSettings();
    const originalText = JSON.stringify(original, null, 2);
    writeSettings(originalText);

    const first = install();
    expect(first.status).toBe('installed');
    // 기존 파일을 바꿨으므로 원본 바이트 그대로의 백업이 남는다.
    expect(first.backupPath).toBe(`${projectPath}${BACKUP_SUFFIX}`);
    expect(readFileSync(first.backupPath as string, 'utf8')).toBe(originalText);

    const afterFirst = readFileSync(projectPath, 'utf8');
    const second = install();
    expect(second).toMatchObject({ status: 'unchanged', backupPath: null });
    expect(readFileSync(projectPath, 'utf8')).toBe(afterFirst);

    const settings = readSettings();
    expect(agentTeamsHooks(settings)).toHaveLength(1);
    expect(settings.hooks.SessionStart).toEqual([...original.hooks.SessionStart, CURRENT_ENTRY]);
    const { hooks: _hooks, ...rest } = settings;
    const { hooks: _originalHooks, ...originalRest } = original;
    expect(rest).toEqual(originalRest);
    expect(settings.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    // 키 순서도 그대로다 — 사용자가 보는 diff가 AgentTeams 항목 한 곳뿐이어야 한다.
    expect(Object.keys(settings)).toEqual(Object.keys(original));
  });

  it('updates an older AgentTeams entry in place', () => {
    const original = userSettings();
    original.hooks.SessionStart.unshift({
      matcher: 'startup',
      hooks: [{ type: 'command', command: COMMAND, timeout: 30 }],
    });
    writeSettings(JSON.stringify(original, null, 2));

    const result = install();

    expect(result.status).toBe('updated');
    expect(result.backupPath).toBe(`${projectPath}${BACKUP_SUFFIX}`);
    const groups = readSettings().hooks.SessionStart;
    expect(agentTeamsHooks(readSettings())).toHaveLength(1);
    // 재설치가 항목을 배열 끝으로 옮기지 않는다.
    expect(groups[0]).toEqual(CURRENT_ENTRY);
    expect(groups[1]).toEqual(original.hooks.SessionStart[1]);
  });

  it('collapses duplicated AgentTeams entries into one', () => {
    const original = userSettings();
    original.hooks.SessionStart.push(structuredClone(CURRENT_ENTRY), structuredClone(CURRENT_ENTRY));
    writeSettings(JSON.stringify(original));

    expect(install().status).toBe('updated');
    expect(agentTeamsHooks(readSettings())).toHaveLength(1);
  });

  it('keeps a user hook that shares a matcher group with the AgentTeams hook', () => {
    const shared = {
      matcher: 'startup',
      hooks: [
        { type: 'command', command: 'echo mine' },
        { type: 'command', command: COMMAND, timeout: 60 },
      ],
    };
    writeSettings(JSON.stringify({ hooks: { SessionStart: [shared] } }));

    expect(install().status).toBe('updated');
    expect(readSettings().hooks.SessionStart).toEqual([
      CURRENT_ENTRY,
      { matcher: 'startup', hooks: [shared.hooks[0]] },
    ]);

    expect(uninstall().status).toBe('removed');
    expect(readSettings()).toEqual({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [shared.hooks[0]] }] } });
  });

  it('restores the pre-install object on uninstall', () => {
    const original = userSettings();
    writeSettings(JSON.stringify(original, null, 2));

    install();
    const result = uninstall();

    expect(result.status).toBe('removed');
    expect(result.backupPath).toBe(`${projectPath}${BACKUP_SUFFIX}`);
    expect(readSettings()).toEqual(original);
  });

  it('drops the emptied hooks keys but keeps the file itself', () => {
    install();
    expect(uninstall().status).toBe('removed');

    expect(existsSync(projectPath)).toBe(true);
    expect(readSettings()).toEqual({});
  });

  it('reports not-installed without writing when there is nothing to remove', () => {
    expect(uninstall()).toMatchObject({ status: 'not-installed', backupPath: null });
    expect(existsSync(projectPath)).toBe(false);

    writeSettings(JSON.stringify(userSettings()));
    const before = readFileSync(projectPath, 'utf8');
    expect(uninstall().status).toBe('not-installed');
    expect(readFileSync(projectPath, 'utf8')).toBe(before);
    expect(existsSync(`${projectPath}${BACKUP_SUFFIX}`)).toBe(false);
  });

  it.each([
    ['broken JSON', '{ "permissions": { "allow": ['],
    // 재직렬화하면 주석이 사라지므로 JSONC도 쓰지 않고 거부한다.
    ['a comment', '{\n  // mine\n  "model": "opus"\n}\n'],
    ['a non-object root', '["not", "settings"]'],
    ['a non-object hooks key', '{ "hooks": [] }'],
    ['a non-array event key', '{ "hooks": { "SessionStart": {} } }'],
  ])('leaves a file with %s untouched and reports an error', (_label, content) => {
    writeSettings(content);

    expect(() => install()).toThrow(SessionHookConfigError);
    expect(() => uninstall()).toThrow(SessionHookConfigError);
    expect(readFileSync(projectPath, 'utf8')).toBe(content);
    expect(existsSync(`${projectPath}${BACKUP_SUFFIX}`)).toBe(false);
  });

  it('treats an empty file as empty settings', () => {
    writeSettings('');

    expect(install().status).toBe('installed');
    expect(readSettings()).toEqual({ hooks: { SessionStart: [CURRENT_ENTRY] } });
  });

  it('keeps the indentation the file already uses', () => {
    writeSettings('{\n\t"model": "opus"\n}\n');

    install();

    expect(readFileSync(projectPath, 'utf8')).toMatch(/^\{\n\t"model": "opus",\n\t"hooks": \{/);
  });

  it('writes nothing on a dry run', () => {
    const text = JSON.stringify(userSettings(), null, 2);
    writeSettings(text);

    const installPreview = install({ dryRun: true });
    expect(installPreview).toMatchObject({ status: 'installed', dryRun: true, backupPath: null });
    expect(installPreview.message).toContain('Dry run');
    expect(installPreview.message).toContain(projectPath);
    expect(readFileSync(projectPath, 'utf8')).toBe(text);

    install();
    const installed = readFileSync(projectPath, 'utf8');
    expect(uninstall({ dryRun: true })).toMatchObject({ status: 'removed', dryRun: true });
    expect(readFileSync(projectPath, 'utf8')).toBe(installed);
  });

  it('does not create a missing file on a dry run', () => {
    expect(install({ dryRun: true }).status).toBe('installed');
    expect(existsSync(projectPath)).toBe(false);
  });

  it('writes a new user-scope file owner-only under the home directory', () => {
    const result = install({ scope: 'user' });

    expect(result).toMatchObject({ status: 'installed', scope: 'user', configPath: userPath });
    expect(existsSync(projectPath)).toBe(false);
    if (isPosix) expect(statSync(userPath).mode & 0o777).toBe(0o600);
  });

  it('uses the project root from a subdirectory unless cwd is explicitly supplied', () => {
    writeSettings('{}', join(cwd, '.agentteams', 'config.json'));
    const nested = join(cwd, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    const currentDirectory = jest.spyOn(process, 'cwd').mockReturnValue(nested);
    try {
      expect(installSessionHook().configPath).toBe(projectPath);
      expect(uninstallSessionHook().configPath).toBe(projectPath);
      expect(installSessionHook({ cwd: nested }).configPath).toBe(join(nested, '.claude', 'settings.json'));
    } finally {
      currentDirectory.mockRestore();
    }
  });

  describe('command input', () => {
    // 홈은 반드시 주입한다. Jest ESM 환경에서는 `process.env.HOME`을 바꿔도 `os.homedir()`가
    // 실제 홈을 돌려주므로, 환경변수로 가리면 user 스코프 테스트가 실제 설정 파일을 쓴다.
    const runCommand = (action: 'install' | 'uninstall', options: Record<string, unknown>) =>
      runSessionHookCommand(action, { cwd, ...options }, { homeDir: home });

    it('refuses the user scope without --yes and writes nothing', () => {
      expect(() => runCommand('install', { scope: 'user' })).toThrow(/--yes/);
      expect(() => runCommand('uninstall', { scope: 'user' })).toThrow(/--yes/);
      expect(existsSync(join(home, '.claude'))).toBe(false);
    });

    it('applies the user scope with --yes and previews it without', () => {
      expect(runCommand('install', { scope: 'user', dryRun: true }).status).toBe('installed');
      expect(existsSync(userPath)).toBe(false);

      expect(runCommand('install', { scope: 'user', yes: true }).configPath).toBe(userPath);
      expect(agentTeamsHooks(readSettings(userPath))).toHaveLength(1);
    });

    it('rejects an unknown client or scope', () => {
      expect(() => runCommand('install', { client: 'codex' })).toThrow(/--client/);
      expect(() => runCommand('install', { scope: 'local' })).toThrow(/--scope/);
      expect(existsSync(projectPath)).toBe(false);
    });
  });

  describe('command wiring', () => {
    const run = async (args: string[]): Promise<string> => {
      const program = createProgram('0.0.0', CANONICAL_CLI_NAME);
      const configureExitOverride = (command: typeof program): void => {
        command.exitOverride();
        for (const subcommand of command.commands) configureExitOverride(subcommand);
      };
      configureExitOverride(program);
      program.configureOutput({ writeErr: () => {} });

      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await program.parseAsync(['node', 'agentteams', 'session', 'hook', ...args], { from: 'node' });
        return log.mock.calls.map((call) => call.join(' ')).join('\n');
      } finally {
        log.mockRestore();
      }
    };

    it('routes install, re-install and uninstall through the session command', async () => {
      writeSettings(JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));

      expect(JSON.parse(await run(['install', '--cwd', cwd, '--dry-run']))).toMatchObject({
        status: 'installed',
        dryRun: true,
      });
      expect(agentTeamsHooks(readSettings())).toHaveLength(0);

      expect(JSON.parse(await run(['install', '--cwd', cwd])).status).toBe('installed');
      expect(JSON.parse(await run(['install', '--cwd', cwd])).status).toBe('unchanged');
      expect(JSON.parse(await run(['uninstall', '--cwd', cwd])).status).toBe('removed');
      expect(readSettings()).toEqual({ permissions: { allow: ['Bash(ls)'] } });
    });

    it('keeps implicit cwd distinct from --cwd through command routing', async () => {
      writeSettings('{}', join(cwd, '.agentteams', 'config.json'));
      const nested = join(cwd, 'packages', 'app');
      mkdirSync(nested, { recursive: true });
      const currentDirectory = jest.spyOn(process, 'cwd').mockReturnValue(nested);
      try {
        expect(JSON.parse(await run(['install', '--dry-run'])).configPath).toBe(projectPath);
        expect(JSON.parse(await run(['install', '--cwd', nested, '--dry-run'])).configPath).toBe(
          join(nested, '.claude', 'settings.json'),
        );
      } finally {
        currentDirectory.mockRestore();
      }
    });

    it('rejects a client outside the registry at parse time', async () => {
      await expect(run(['install', '--cwd', cwd, '--client', 'codex'])).rejects.toBeInstanceOf(CommanderError);
      expect(existsSync(projectPath)).toBe(false);
    });
  });
});
