import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_SUFFIX } from '../src/mcp-registration/atomicWrite.js';
import { runMcpInstallCommand } from '../src/mcp-registration/index.js';
import { parseJsonc } from '../src/mcp-registration/jsonc.js';
import type { McpCredentials } from '../src/mcp-registration/serverSpec.js';
import type { McpPathContext } from '../src/mcp-registration/types.js';
import type { VendorCommandResult, VendorRunner } from '../src/mcp-registration/vendorCommand.js';

const CANARY_API_KEY = 'key_canary_2b91f4ad6c07e358_never_print_me';
const isPosix = process.platform !== 'win32';

const credentials: McpCredentials = {
  projectId: 'project-fixture',
  teamId: 'team-fixture',
  apiUrl: 'https://api.agentteams.run',
};

/** A vendor runner that never spawns anything, so tests stay hermetic. */
function fakeRunner(result: Partial<VendorCommandResult>, calls: { executable: string; args: string[] }[] = []) {
  const runner: VendorRunner = (executable, args) => {
    calls.push({ executable, args });
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return runner;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A PATH containing a global `agentteams`, i.e. the machine the bare-executable spec assumes. */
function makeGlobalInstallBin(): string {
  const bin = mkdtempSync(join(tmpdir(), 'agentteams-mcp-bin-'));
  writeFileSync(join(bin, 'agentteams'), '', 'utf-8');
  return bin;
}

describe('mcp install', () => {
  let home: string;
  let cwd: string;
  let bin: string;
  let context: McpPathContext;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentteams-mcp-install-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'agentteams-mcp-install-cwd-'));
    bin = makeGlobalInstallBin();
    context = { homeDir: home, cwd, env: { PATH: bin } as NodeJS.ProcessEnv };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  const install = (options: Record<string, unknown>, vendorRunner?: VendorRunner) =>
    runMcpInstallCommand(options, { credentials, context, vendorRunner });

  describe('file merge strategy', () => {
    const cursorUserConfig = () => join(home, '.cursor', 'mcp.json');

    it('preserves existing servers and comments, and is idempotent across two runs', () => {
      mkdirSync(join(home, '.cursor'), { recursive: true });
      writeFileSync(
        cursorUserConfig(),
        `{
  // hand-written by me
  "mcpServers": {
    "other": { "command": "npx", "args": ["-y", "other-mcp"] }
  }
}
`,
        { encoding: 'utf-8', mode: 0o644 },
      );

      const first = install({ client: 'cursor-cli', scope: 'user' });
      expect(first.exitCode).toBe(0);
      expect(first.text).toContain('[INSTALLED]');

      const afterFirst = readFileSync(cursorUserConfig(), 'utf-8');
      const servers = () => (parseJsonc(afterFirst) as { mcpServers: Record<string, unknown> }).mcpServers;
      expect(afterFirst).toContain('// hand-written by me');
      expect(servers().other).toEqual({ command: 'npx', args: ['-y', 'other-mcp'] });
      expect(Object.keys(servers())).toEqual(['other', 'agentteams']);

      const second = install({ client: 'cursor-cli', scope: 'user' });
      expect(second.text).toContain('[ALREADY_REGISTERED]');
      expect(readFileSync(cursorUserConfig(), 'utf-8')).toEqual(afterFirst);
      expect(Object.keys(servers())).toHaveLength(2);

      if (isPosix) {
        expect(statSync(cursorUserConfig()).mode & 0o777).toBe(0o600);
        expect(statSync(`${cursorUserConfig()}${BACKUP_SUFFIX}`).mode & 0o777).toBe(0o600);
      }
      expect(existsSync(`${cursorUserConfig()}${BACKUP_SUFFIX}`)).toBe(true);
    });

    it('creates a new user-scope file as 0600 with no backup', () => {
      const result = install({ client: 'cursor-cli', scope: 'user' });

      expect(result.text).toContain('[INSTALLED]');
      if (isPosix) {
        expect(statSync(cursorUserConfig()).mode & 0o777).toBe(0o600);
      }
      const entry = JSON.parse(readFileSync(cursorUserConfig(), 'utf-8')).mcpServers.agentteams;
      expect(entry).toEqual({ command: 'agentteams', args: ['mcp'], env: {} });
      expect(readFileSync(cursorUserConfig(), 'utf-8')).not.toContain(CANARY_API_KEY);
      expect(existsSync(`${cursorUserConfig()}${BACKUP_SUFFIX}`)).toBe(false);
      expect(result.text).not.toContain('Backup:');
    });

    it('falls back to npx when no global agentteams is on PATH', () => {
      // `npx @agentteams/cli mcp install` and GUI-launched clients (which never source a
      // login shell) both hit this. A bare `agentteams` there fails as an opaque
      // "server failed to start" inside the client, with nothing pointing at PATH.
      const result = runMcpInstallCommand(
        { client: 'cursor-cli', scope: 'user' },
        { credentials, context: { homeDir: home, cwd, env: { PATH: '' } as NodeJS.ProcessEnv } },
      );

      expect(result.text).toContain('[INSTALLED]');
      const entry = JSON.parse(readFileSync(cursorUserConfig(), 'utf-8')).mcpServers.agentteams;
      expect(entry).toEqual({ command: 'npx', args: ['-y', '@agentteams/cli', 'mcp'], env: {} });
    });

    it('writes an explicitly selected profile into the installed argv and reports the same value', () => {
      const result = install({ client: 'cursor-cli', scope: 'user', toolProfile: 'comments' }) as {
        text: string;
        json: { toolProfile: string; server: { args: string[] } };
      };
      const entry = JSON.parse(readFileSync(cursorUserConfig(), 'utf-8')).mcpServers.agentteams;

      expect(entry.args).toEqual(['mcp', '--tool-profile', 'comments']);
      expect(result.text).toContain('Tool profile: comments');
      expect(result.json.toolProfile).toBe('comments');
      expect(result.json.server.args).toEqual(entry.args);
    });

    it('does not rewrite an existing secret-free entry when credentials change', () => {
      install({ client: 'cursor-cli', scope: 'user' });
      const before = readFileSync(cursorUserConfig(), 'utf-8');

      const repointed = runMcpInstallCommand(
        { client: 'cursor-cli', scope: 'user' },
        { credentials: { ...credentials, projectId: 'project-second' }, context },
      );

      expect(repointed.text).toContain('[ALREADY_REGISTERED]');
      const parsed = JSON.parse(readFileSync(cursorUserConfig(), 'utf-8'));
      expect(Object.keys(parsed.mcpServers)).toEqual(['agentteams']);
      expect(parsed.mcpServers.agentteams.env).toEqual({});
      expect(readFileSync(cursorUserConfig(), 'utf-8')).toBe(before);
      expect(existsSync(`${cursorUserConfig()}${BACKUP_SUFFIX}`)).toBe(false);
    });

    it('writes an empty environment at both user and project scope', () => {
      install({ client: 'cursor-cli', scope: 'user' });
      const userConfig = readFileSync(cursorUserConfig(), 'utf-8');
      expect(userConfig).not.toContain(CANARY_API_KEY);
      expect(JSON.parse(userConfig).mcpServers.agentteams.env).toEqual({});

      install({ client: 'cursor-cli', scope: 'project' });
      const projectConfig = readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf-8');
      expect(projectConfig).not.toContain(CANARY_API_KEY);
      expect(projectConfig).not.toContain('AGENTTEAMS_');
      expect(JSON.parse(projectConfig).mcpServers.agentteams.env).toEqual({});
    });

    it.each([
      ['kimi-cli', () => join(home, '.kimi-code', 'mcp.json')],
      ['antigravity', () => join(home, '.gemini', 'config', 'mcp_config.json')],
    ])('writes %s user config at its documented path', (clientId, pathFor) => {
      expect(install({ client: clientId, scope: 'user' }).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(pathFor(), 'utf-8')).mcpServers.agentteams.command).toBe('agentteams');
    });

    it('treats a zero-byte config as "create it" rather than as corruption', () => {
      const target = join(home, '.gemini', 'config', 'mcp_config.json');
      mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
      writeFileSync(target, '', 'utf-8');

      expect(install({ client: 'antigravity', scope: 'user' }).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(target, 'utf-8')).mcpServers.agentteams).toBeDefined();
    });

    it('leaves a corrupt config byte-identical and returns the manual snippet', () => {
      mkdirSync(join(home, '.cursor'), { recursive: true });
      writeFileSync(cursorUserConfig(), '{ "mcpServers": { "broken" ', 'utf-8');
      const before = hashFile(cursorUserConfig());

      const result = install({ client: 'cursor-cli', scope: 'user' });

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain('[FAILED]');
      expect(result.text).toContain('left unchanged');
      expect(result.text).toContain('Manual fallback:');
      expect(hashFile(cursorUserConfig())).toBe(before);
      expect(existsSync(`${cursorUserConfig()}${BACKUP_SUFFIX}`)).toBe(false);
    });

    (isPosix ? it : it.skip)('leaves the original intact when a POSIX target directory is read-only', () => {
      const directory = join(home, '.cursor');
      mkdirSync(directory, { recursive: true });
      writeFileSync(cursorUserConfig(), '{\n  "mcpServers": {}\n}\n', 'utf-8');
      const before = hashFile(cursorUserConfig());
      chmodSync(directory, 0o500);

      try {
        const result = install({ client: 'cursor-cli', scope: 'user' });
        expect(result.exitCode).toBe(1);
        expect(result.text).toContain('[FAILED]');
        expect(hashFile(cursorUserConfig())).toBe(before);
      } finally {
        chmodSync(directory, 0o700);
      }
    });
  });

  describe('vendor command strategy', () => {
    it('passes no credential or binding environment values to a vendor CLI argv', () => {
      const calls: { executable: string; args: string[] }[] = [];
      const result = install(
        { client: 'claude-code', scope: 'project' },
        fakeRunner({ status: 0, stdout: `Added server with ${CANARY_API_KEY}` }, calls),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].executable).toBe('claude');
      expect(calls[0].args).not.toContain(`AGENTTEAMS_API_KEY=${CANARY_API_KEY}`);
      expect(calls[0].args.join(' ')).not.toContain('AGENTTEAMS_');
      expect(calls[0].args.slice(0, 5)).toEqual(['mcp', 'add', 'agentteams', '--scope', 'project']);
      expect(calls[0].args.slice(-2)).toEqual(['agentteams', 'mcp']);

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('[INSTALLED]');
      expect(result.text).not.toContain(CANARY_API_KEY);
      expect(JSON.stringify(result.json)).not.toContain(CANARY_API_KEY);
    });

    it('classifies a vendor refusal as ALREADY_REGISTERED rather than a failure', () => {
      const result = install(
        { client: 'amp', scope: 'project' },
        fakeRunner({ status: 1, stderr: 'Error: Server "agentteams" already exists. To update it, remove it first' }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('[ALREADY_REGISTERED]');
      expect(result.text).toContain('Manual fallback:');
    });

    it('reports a redacted failure when the vendor command errors out', () => {
      const result = install(
        { client: 'amp', scope: 'project' },
        fakeRunner({ status: 3, stderr: `boom: token ${CANARY_API_KEY} rejected` }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain('[FAILED]');
      expect(result.text).toContain('exited with code 3');
      expect(result.text).toContain('***');
      expect(result.text).not.toContain(CANARY_API_KEY);
    });

    it('reports a missing executable without touching any file', () => {
      const result = install(
        { client: 'amp', scope: 'project' },
        fakeRunner({ status: null, spawnError: 'spawn amp ENOENT' }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain('[FAILED]');
      expect(result.text).toContain('ENOENT');
      expect(existsSync(join(home, '.config', 'amp', 'settings.json'))).toBe(false);
    });

    it('sends the project-scope flag without environment values for Amp workspace settings', () => {
      const calls: { executable: string; args: string[] }[] = [];
      install({ client: 'amp', scope: 'project' }, fakeRunner({ status: 0 }, calls));

      expect(calls[0].args).toContain('--workspace');
      expect(calls[0].args.join(' ')).not.toContain('AGENTTEAMS_');
      expect(calls[0].args.join(' ')).not.toContain(CANARY_API_KEY);
      expect(calls[0].args.slice(-2)).toEqual(['agentteams', 'mcp']);
    });
  });

  describe('config-only combinations', () => {
    it('returns SKIPPED_CONFIG_ONLY with a reason and exit code 0 for Codex project scope', () => {
      const result = install({ client: 'codex', scope: 'project' });

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('[SKIPPED_CONFIG_ONLY]');
      expect(result.text).toContain('comment-preserving TOML editor');
      expect(result.text).toContain('[mcp_servers.agentteams]');
      expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
    });

    it('keeps Codex user install config-only so no API key enters argv', () => {
      const calls: { executable: string; args: string[] }[] = [];
      const result = install({ client: 'codex', scope: 'user' }, fakeRunner({ status: 0 }, calls));

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('[SKIPPED_CONFIG_ONLY]');
      expect(result.text).not.toContain('AGENTTEAMS_API_KEY');
      expect(calls).toHaveLength(0);
    });
  });

  it('defaults an omitted single-client scope to the project config', () => {
    const result = install({ client: 'cursor-cli' });

    expect(result.json).toMatchObject({ scope: 'project' });
    expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
    expect(result.text).not.toContain('machine-wide');
  });

  it('explains that a user-scope entry resolves project identity at runtime', () => {
    const result = install({ client: 'cursor-cli', scope: 'user' });
    expect(result.text).not.toContain('machine-wide');
    expect(result.text).toContain('no credentials or project binding');
    expect(result.text).toContain('project-fixture');
    expect(result.text).toContain('team-fixture');
  });

  it('rejects unknown clients before doing anything', () => {
    expect(() => install({ client: 'orca', scope: 'user' })).toThrow(/Unknown client: orca/);
  });
});
