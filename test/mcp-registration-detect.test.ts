import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClients } from '../src/mcp-registration/detect.js';
import { runMcpInstallCommand } from '../src/mcp-registration/index.js';
import type { McpCredentials } from '../src/mcp-registration/serverSpec.js';
import type { DetectionSignal, McpPathContext } from '../src/mcp-registration/types.js';
import type { VendorCommandResult, VendorRunner } from '../src/mcp-registration/vendorCommand.js';

const CANARY_API_KEY = 'key_canary_detect_5d0e1f2a3b4c';

const credentials: McpCredentials = {
  projectId: 'project-fixture',
  teamId: 'team-fixture',
  apiUrl: 'https://api.agentteams.run',
};

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) snapshot[fullPath] = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
    }
  };
  walk(root);
  return snapshot;
}

function byId(signals: DetectionSignal[]): Record<string, DetectionSignal> {
  return Object.fromEntries(signals.map((signal) => [signal.clientId, signal]));
}

describe('mcp client detection', () => {
  let home: string;
  let cwd: string;
  let binDir: string;
  let context: McpPathContext;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentteams-mcp-detect-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'agentteams-mcp-detect-cwd-'));
    binDir = mkdtempSync(join(tmpdir(), 'agentteams-mcp-detect-bin-'));
    context = { homeDir: home, cwd, env: { PATH: binDir } as NodeJS.ProcessEnv };
  });

  afterEach(() => {
    for (const directory of [home, cwd, binDir]) rmSync(directory, { recursive: true, force: true });
  });

  const fakeExecutable = (name: string) => writeFileSync(join(binDir, name), '#!/bin/sh\n', { mode: 0o755 });

  it('separates the four signal combinations with the evidence that produced them', () => {
    // configured only
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), '{}\n');
    // executable only
    fakeExecutable('codex');
    // both
    fakeExecutable('claude');
    writeFileSync(join(home, '.claude.json'), '{}\n');
    // neither: amp

    const signals = byId(detectClients({ context }));

    expect(signals['cursor-cli'].evidence).toBe('configured');
    expect(signals['cursor-cli'].executablePath).toBeNull();
    expect(signals['cursor-cli'].detected).toBe(true);

    expect(signals['codex'].evidence).toBe('executable');
    expect(signals['codex'].executablePath).toBe(join(binDir, 'codex'));
    expect(signals['codex'].configPaths).toEqual([]);

    expect(signals['claude-code'].evidence).toBe('both');
    expect(signals['claude-code'].detected).toBe(true);

    expect(signals['amp'].evidence).toBe('none');
    expect(signals['amp'].detected).toBe(false);
  });

  it('finds a client installed outside PATH through its declared extra bin directory', () => {
    const kimiBin = join(home, '.kimi-code', 'bin');
    mkdirSync(kimiBin, { recursive: true });
    writeFileSync(join(kimiBin, 'kimi'), '#!/bin/sh\n', { mode: 0o755 });

    const signals = byId(detectClients({ context }));
    expect(signals['kimi-cli'].executablePath).toBe(join(kimiBin, 'kimi'));
  });

  it('finds Kiro CLI through the ~/.local/bin symlink its installer leaves outside the runner PATH', () => {
    const localBin = join(home, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, 'kiro-cli'), '#!/bin/sh\n', { mode: 0o755 });

    const signals = byId(detectClients({ context }));
    expect(signals['kiro-cli'].executablePath).toBe(join(localBin, 'kiro-cli'));
  });

  it('skips a PATH name collision and detects the official Grok Build path', () => {
    fakeExecutable('grok');
    const grokBin = join(home, '.grok', 'bin');
    mkdirSync(grokBin, { recursive: true });
    writeFileSync(join(grokBin, 'grok'), '#!/bin/sh\n', { mode: 0o755 });

    const signals = byId(
      detectClients({
        context,
        probeExecutable: (executablePath) =>
          executablePath === join(grokBin, 'grok') ? 'Grok Build TUI' : 'Grok CLI - AI assistant',
      }),
    );

    expect(signals['grok-build'].executablePath).toBe(join(grokBin, 'grok'));
  });

  it('skips a PATH name collision and detects the official Oh My Pi path', () => {
    fakeExecutable('omp');
    const localBin = join(home, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, 'omp'), '#!/bin/sh\n', { mode: 0o755 });

    const signals = byId(
      detectClients({
        context,
        probeExecutable: (executablePath) =>
          executablePath === join(localBin, 'omp') ? 'omp v18.0.4\nOh My Pi as an ACP' : 'omp 1.0.0',
      }),
    );

    expect(signals.omp.executablePath).toBe(join(localBin, 'omp'));
  });

  it('detects Kiro CLI from its settings directory alone', () => {
    mkdirSync(join(home, '.kiro', 'settings'), { recursive: true });
    writeFileSync(join(home, '.kiro', 'settings', 'mcp.json'), '{}\n');

    const signals = byId(detectClients({ context }));
    expect(signals['kiro-cli'].evidence).toBe('configured');
    expect(signals['kiro-cli'].detected).toBe(true);
  });

  it('detects Codex, Copilot and Kiro from their overridden homes', () => {
    const codexHome = join(home, 'custom-codex');
    const copilotHome = join(home, 'custom-copilot');
    const kiroHome = join(home, 'custom-kiro');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(copilotHome, { recursive: true });
    mkdirSync(join(kiroHome, 'settings'), { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), '');
    writeFileSync(join(copilotHome, 'mcp-config.json'), '{}\n');
    writeFileSync(join(kiroHome, 'settings', 'mcp.json'), '{}\n');

    const signals = byId(
      detectClients({
        context: {
          ...context,
          env: { ...context.env, CODEX_HOME: codexHome, COPILOT_HOME: copilotHome, KIRO_HOME: kiroHome },
        },
      }),
    );

    expect(signals.codex.configPaths).toEqual([join(codexHome, 'config.toml'), codexHome]);
    expect(signals['copilot-cli'].configPaths).toEqual([join(copilotHome, 'mcp-config.json'), copilotHome]);
    expect(signals['kiro-cli'].configPaths).toEqual([join(kiroHome, 'settings', 'mcp.json'), kiroHome]);
  });

  it('detects Oh My Pi from PI_CODING_AGENT_DIR', () => {
    const ompHome = join(home, 'custom-omp-agent');
    mkdirSync(ompHome, { recursive: true });
    writeFileSync(join(ompHome, 'mcp.json'), '{}\n');

    const signals = byId(
      detectClients({
        context: { ...context, env: { ...context.env, PI_CODING_AGENT_DIR: ompHome } },
      }),
    );

    expect(signals.omp.configPaths).toEqual([join(ompHome, 'mcp.json'), ompHome]);
  });

  describe('batch install', () => {
    const run = (options: Record<string, unknown>, vendorRunner?: VendorRunner) =>
      runMcpInstallCommand(options, { credentials, context, vendorRunner });

    beforeEach(() => {
      fakeExecutable('claude');
      fakeExecutable('cursor-agent');
    });

    it('prints a plan with detection evidence and changes nothing without --yes', () => {
      writeFileSync(join(cwd, 'seed.txt'), 'seed\n');
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };

      const result = run({ scope: 'user' });

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('preview (no files were changed)');
      expect(result.text).toContain('claude-code [will apply] executable');
      expect(result.text).toContain('cursor-cli [will apply] executable');
      expect(result.text).toContain('amp [skip] not detected');
      expect(result.text).toContain('Not detected on this machine.');
      expect(result.text).toContain('project-fixture');
      expect(result.text).toContain('no credentials or project binding');
      expect(result.text).not.toContain('machine-wide');

      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('applies only detected clients and reports skips separately when --yes is given', () => {
      const result = run({ yes: true, scope: 'user' }, () => ({ status: 0, stdout: 'added', stderr: '' }));

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('claude-code [INSTALLED]');
      expect(result.text).toContain('cursor-cli [INSTALLED]');
      expect(result.text).toContain('amp [SKIPPED_NOT_DETECTED]');
      expect(result.text).toContain('Summary: 2 registered, 9 skipped, 0 failed.');
    });

    it('runs Grok registration through the verified absolute path in batch mode', () => {
      const grokBin = join(home, '.grok', 'bin');
      const officialGrok = join(grokBin, 'grok');
      mkdirSync(grokBin, { recursive: true });
      writeFileSync(officialGrok, '#!/bin/sh\n', { mode: 0o755 });
      const calls: { executable: string; args: string[] }[] = [];
      const runner: VendorRunner = (executable, args) => {
        calls.push({ executable, args });
        return args[0] === '--help'
          ? { status: 0, stdout: 'Grok Build TUI', stderr: '' }
          : { status: 0, stdout: 'added', stderr: '' };
      };

      const result = runMcpInstallCommand(
        { yes: true, scope: 'user' },
        {
          credentials,
          context,
          vendorRunner: runner,
          detectionDependencies: { probeExecutable: () => 'Grok Build TUI' },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(calls.filter((call) => call.executable === officialGrok)).toHaveLength(2);
      expect(calls.some((call) => call.executable === 'grok')).toBe(false);
    });

    /**
     * A failure mid-plan must not strand the clients behind it, and it must not
     * be summarised as success either.
     */
    it('continues past a failing client and still exits non-zero', () => {
      fakeExecutable('codex');
      writeFileSync(join(home, '.claude.json'), '{ broken');

      const runner: VendorRunner = (executable): VendorCommandResult => {
        if (executable === 'claude') return { status: 9, stdout: '', stderr: 'claude blew up' };
        return { status: 0, stdout: 'added', stderr: '' };
      };

      const result = run({ yes: true, scope: 'user' }, runner);

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain('claude-code [FAILED]');
      // Both clients listed after the failure are still attempted and still registered.
      expect(result.text).toContain('codex [INSTALLED]');
      expect(result.text).toContain('cursor-cli [INSTALLED]');
      expect(result.text).toContain('Summary: 2 registered, 8 skipped, 1 failed.');
    });

    /**
     * The command is named `install`, so the argument-free project-scope run is the
     * one that registers every detected client. Nothing extra is asked for: project
     * files are repository state the caller already owns.
     */
    it('applies every detected client at project scope with no extra approval', () => {
      const result = run({}, () => ({ status: 0, stdout: 'added', stderr: '' })) as {
        text: string;
        exitCode: number;
        json: { scope: string; dryRun: boolean; summary: { applied: number } };
      };

      expect(result.exitCode).toBe(0);
      expect(result.json.scope).toBe('project');
      expect(result.json.dryRun).toBe(false);
      expect(result.text).toContain('applied at project scope');
      // claude-code registers through its own CLI, cursor-cli through a JSON merge —
      // both detected here, so both must be handled by the single command.
      expect(result.text).toContain('claude-code [INSTALLED]');
      expect(result.text).toContain('cursor-cli [INSTALLED]');
      expect(result.text).toContain('amp [SKIPPED_NOT_DETECTED]');
      expect(result.json.summary.applied).toBe(2);
      expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(true);
      // Project scope writes into the repository, never into the machine-wide config.
      expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
    });

    it('previews the same project targets under --dry-run without writing or spawning anything', () => {
      writeFileSync(join(cwd, 'seed.txt'), 'seed\n');
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };
      const calls: { executable: string; args: string[] }[] = [];

      const result = run({ dryRun: true }, (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: 'added', stderr: '' };
      }) as {
        text: string;
        exitCode: number;
        json: { scope: string; dryRun: boolean; plan: { entries: { scope: string; targetPath: string }[] } };
      };

      expect(result.exitCode).toBe(0);
      expect(result.json.scope).toBe('project');
      expect(result.json.dryRun).toBe(true);
      expect(result.text).toContain('dry run (no files were changed)');
      expect(result.text).toContain('claude-code [will apply]');
      expect(result.text).toContain('cursor-cli [will apply]');
      expect(result.text).toContain(`target: ${join(cwd, '.cursor', 'mcp.json')}`);
      expect(result.json.plan.entries.every((entry) => entry.scope === 'project')).toBe(true);
      expect(calls).toHaveLength(0);
      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    /**
     * 데스크탑 앱과의 계약 테스트.
     *
     * `desktop/src/main/localAgent/mcpCli.ts`의 `planInstall()`은 이 argv를 그대로
     * 실행하고 응답의 `dryRun === true`를 요구한다. CLI와 desktop은 따로 배포되므로,
     * 이 argv가 적용으로 바뀌면 이미 설치된 데스크탑이 동의 없이 파일을 쓴다.
     * desktop 테스트는 가짜 CLI 스텁만 상대하므로 그 회귀는 이쪽에서만 잡힌다.
     */
    it('keeps the desktop planInstall argv a preview: --scope project --json writes nothing', () => {
      writeFileSync(join(cwd, 'seed.txt'), 'seed\n');
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };
      const calls: { executable: string; args: string[] }[] = [];

      const result = run({ scope: 'project', json: true }, (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: 'added', stderr: '' };
      }) as {
        text: string;
        exitCode: number;
        json: { scope: string; dryRun: boolean; plan: { entries: { clientId: string }[] } };
      };

      expect(result.exitCode).toBe(0);
      expect(result.json.scope).toBe('project');
      expect(result.json.dryRun).toBe(true);
      expect(result.json.plan.entries.length).toBeGreaterThan(0);
      expect(calls).toHaveLength(0);
      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('applies the same --json batch once --yes says so explicitly', () => {
      const result = run({ scope: 'project', json: true, yes: true }, () => ({
        status: 0,
        stdout: 'added',
        stderr: '',
      })) as { text: string; json: { dryRun: boolean; summary: { applied: number } } };

      expect(result.json.dryRun).toBe(false);
      expect(result.json.summary.applied).toBeGreaterThan(0);
      expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(true);
    });

    /**
     * `claude-code`와 `copilot-cli`는 project 스코프에서 같은 `.mcp.json`을 대상으로
     * 하되 전략이 다르다(vendorCommand / jsonMerge). 한 번의 배치가 같은 파일을 두 번
     * 쓰면 뒤 전략이 앞 결과를 덮고 백업까지 만들며, 파일 하나가 등록 둘로 집계된다.
     */
    it('writes a shared .mcp.json once when two clients target it', () => {
      mkdirSync(join(home, '.copilot'), { recursive: true });
      writeFileSync(join(home, '.copilot', 'mcp-config.json'), '{}\n');
      const calls: { executable: string; args: string[] }[] = [];

      const result = run({ yes: true }, (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: 'added', stderr: '' };
      }) as {
        text: string;
        json: { results: { clientId: string; outcome: string; configPath: string; detail: string }[] };
      };

      const byClient = Object.fromEntries(result.json.results.map((entry) => [entry.clientId, entry]));
      expect(byClient['claude-code'].outcome).toBe('INSTALLED');
      expect(byClient['copilot-cli'].outcome).toBe('ALREADY_REGISTERED');
      expect(byClient['copilot-cli'].configPath).toBe(join(cwd, '.mcp.json'));
      expect(byClient['copilot-cli'].detail).toContain('Claude Code');
      // The vendor CLI is the only writer of that path, so the merge pass left no file.
      expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
      expect(calls.filter((call) => call.executable.endsWith('claude'))).toHaveLength(1);
    });

    /**
     * 설정 흔적은 있는데 실행 파일이 없는 클라이언트를 "감지되지 않음"으로 접으면,
     * 실행 파일을 설치하면 해결된다는 단서가 출력에서 통째로 사라진다.
     */
    it('separates a configured client whose CLI is missing from one that is absent', () => {
      writeFileSync(join(home, '.claude.json'), '{}\n');
      rmSync(join(binDir, 'claude'));

      const result = run({ yes: true }, () => ({ status: 0, stdout: 'added', stderr: '' })) as {
        text: string;
        json: { results: { clientId: string; outcome: string }[] };
      };

      const byClient = Object.fromEntries(result.json.results.map((entry) => [entry.clientId, entry]));
      expect(byClient['claude-code'].outcome).toBe('SKIPPED_NO_EXECUTABLE');
      expect(byClient['amp'].outcome).toBe('SKIPPED_NOT_DETECTED');
      expect(result.text).toContain('claude-code [SKIPPED_NO_EXECUTABLE]');
    });

    /**
     * project 스코프 파일은 커밋돼 남의 머신에서 읽힌다. 등록한 머신에 전역
     * `agentteams`가 있었는지가 그 파일에 들어가면 안 된다.
     */
    it('records a machine-independent runtime for project scope and the fast one for user scope', () => {
      fakeExecutable('agentteams');

      const project = run({ yes: true }, () => ({ status: 0, stdout: 'added', stderr: '' })) as {
        text: string;
        json: { server: { command: string; args: string[] } };
      };
      expect(project.json.server.command).toBe('npx');
      expect(project.json.server.args).toEqual(['-y', '@agentteams/cli', 'mcp']);
      expect(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf-8')).mcpServers.agentteams.command).toBe(
        'npx',
      );

      const user = run({ scope: 'user', yes: true }, () => ({ status: 0, stdout: 'added', stderr: '' })) as {
        json: { server: { command: string } };
      };
      expect(user.json.server.command).toBe('agentteams');
    });

    // --dry-run이 단일 클라이언트 경로로 새면 미리보기가 파일을 쓴다. 그 방향을 막는다.
    it('previews a single client with --dry-run instead of installing it', () => {
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };
      const calls: { executable: string; args: string[] }[] = [];

      const result = run({ client: 'cursor-cli', dryRun: true }, (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: 'added', stderr: '' };
      }) as { text: string; json: { dryRun: boolean; plan: { entries: { clientId: string }[] } } };

      expect(result.json.dryRun).toBe(true);
      expect(result.json.plan.entries.map((entry) => entry.clientId)).toEqual(['cursor-cli']);
      expect(result.text).toContain('cursor-cli [will apply]');
      expect(calls).toHaveLength(0);
      expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(false);
      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('still rejects an unknown --client under --dry-run', () => {
      expect(() => run({ client: 'orca', dryRun: true })).toThrow(/Unknown client: orca/);
    });

    it('refuses --dry-run together with --yes and leaves the tree untouched', () => {
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };

      expect(() => run({ dryRun: true, yes: true })).toThrow(/--dry-run cannot be combined with --yes/);
      expect(() => run({ dryRun: true, yes: true, scope: 'user' })).toThrow(/--dry-run cannot be combined with --yes/);

      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('keeps the user scope behind --yes and applies it only when approved', () => {
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };

      const preview = run({ scope: 'user' });
      expect(preview.text).toContain('preview (no files were changed)');
      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);

      const applied = run({ scope: 'user', yes: true }, () => ({ status: 0, stdout: 'added', stderr: '' }));
      expect(applied.text).toContain('applied at user scope');
      expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(true);
    });

    it('registers Codex through its own CLI at user scope and prints the manual TOML for the project scope', () => {
      const codexPath = join(binDir, 'codex');
      fakeExecutable('codex');
      const calls: { executable: string; args: string[] }[] = [];
      const runner: VendorRunner = (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: "Added global MCP server 'agentteams'.", stderr: '' };
      };

      const user = run({ scope: 'user', yes: true }, runner);
      expect(user.text).toContain('codex [INSTALLED]');
      const codexCall = calls.find((call) => call.executable === codexPath);
      expect(codexCall?.args).toEqual(['mcp', 'add', 'agentteams', '--', 'npx', '-y', '@agentteams/cli', 'mcp']);
      // Codex CLI owns that file; we never rewrite the user TOML ourselves.
      expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);

      const project = run({}, runner) as {
        exitCode: number;
        text: string;
        json: { results: { clientId: string; manualSnippet?: string }[] };
      };
      expect(project.exitCode).toBe(0);
      expect(project.text).toContain('codex [SKIPPED_CONFIG_ONLY]');
      expect(project.text).toContain('Manual configuration is still needed for:');
      expect(project.text).toContain('[mcp_servers.agentteams]');
      const codexResult = project.json.results.find((result) => result.clientId === 'codex');
      expect(codexResult?.manualSnippet).toContain('[mcp_servers.agentteams]');
      expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
    });

    it('never prints key material in a plan or an applied summary', () => {
      const plan = run({ dryRun: true });
      // Even if a vendor CLI echoes a key from the user's own environment, it must not
      // survive into the summary — registration itself passes no credential at all.
      const applied = run({ yes: true, scope: 'user' }, () => ({
        status: 0,
        stdout: `Added server with ${CANARY_API_KEY}`,
        stderr: '',
      }));

      for (const output of [plan, applied]) {
        expect(output.text).not.toContain(CANARY_API_KEY);
        expect(JSON.stringify(output.json)).not.toContain(CANARY_API_KEY);
      }
    });
  });
});
