import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClients } from '../src/mcp-registration/detect.js';
import { runMcpInstallCommand } from '../src/mcp-registration/index.js';
import type { McpCredentials } from '../src/mcp-registration/serverSpec.js';
import type { DetectionSignal, McpPathContext } from '../src/mcp-registration/types.js';
import type { VendorCommandResult, VendorRunner } from '../src/mcp-registration/vendorCommand.js';

const credentials: McpCredentials = {
  apiKey: 'key_canary_detect_5d0e1f2a3b4c',
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

  it('detects Codex and Copilot from their overridden homes', () => {
    const codexHome = join(home, 'custom-codex');
    const copilotHome = join(home, 'custom-copilot');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(copilotHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), '');
    writeFileSync(join(copilotHome, 'mcp-config.json'), '{}\n');

    const signals = byId(
      detectClients({
        context: {
          ...context,
          env: { ...context.env, CODEX_HOME: codexHome, COPILOT_HOME: copilotHome },
        },
      }),
    );

    expect(signals.codex.configPaths).toEqual([join(codexHome, 'config.toml'), codexHome]);
    expect(signals['copilot-cli'].configPaths).toEqual([join(copilotHome, 'mcp-config.json'), copilotHome]);
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

      const result = run({});

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('dry run (no files were changed)');
      expect(result.text).toContain('claude-code [will apply] executable');
      expect(result.text).toContain('cursor-cli [will apply] executable');
      expect(result.text).toContain('amp [skip] not detected');
      expect(result.text).toContain('Not detected on this machine.');
      expect(result.text).toContain('project-fixture');
      expect(result.text).toContain('machine-wide');

      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('applies only detected clients and reports skips separately when --yes is given', () => {
      const result = run({ yes: true }, () => ({ status: 0, stdout: 'added', stderr: '' }));

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('claude-code [INSTALLED]');
      expect(result.text).toContain('cursor-cli [INSTALLED]');
      expect(result.text).toContain('amp [SKIPPED_NOT_DETECTED]');
      expect(result.text).toContain('Summary: 2 registered, 6 skipped, 0 failed.');
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

      const result = run({ yes: true }, runner);

      expect(result.exitCode).toBe(1);
      expect(result.text).toContain('claude-code [FAILED]');
      expect(result.text).toContain('codex [SKIPPED_CONFIG_ONLY]');
      expect(result.text).toContain('cursor-cli [INSTALLED]');
      expect(result.text).toContain('Summary: 1 registered, 6 skipped, 1 failed.');
    });

    it('refuses --scope project in batch mode without touching anything', () => {
      const before = { ...snapshotTree(home), ...snapshotTree(cwd) };

      expect(() => run({ yes: true, scope: 'project' })).toThrow(/does not support --scope project/);
      expect(() => run({ scope: 'project' })).toThrow(/does not support --scope project/);
      expect({ ...snapshotTree(home), ...snapshotTree(cwd) }).toEqual(before);
    });

    it('never prints the API key in a plan or an applied summary', () => {
      const plan = run({});
      const applied = run({ yes: true }, () => ({ status: 0, stdout: '', stderr: '' }));

      for (const output of [plan, applied]) {
        expect(output.text).not.toContain(credentials.apiKey);
        expect(JSON.stringify(output.json)).not.toContain(credentials.apiKey);
      }
    });
  });
});
