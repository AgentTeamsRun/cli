import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_SUFFIX } from '../src/mcp-registration/atomicWrite.js';
import { runMcpDoctorCommand, type McpDoctorReport } from '../src/mcp-registration/doctor.js';
import type { McpPathContext } from '../src/mcp-registration/types.js';

const CANARY_API_KEY = 'key_doctor_canary_f91d58c7_never_print_me';

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('mcp doctor', () => {
  let home: string;
  let cwd: string;
  let bin: string;
  let context: McpPathContext;

  const projectConfigPath = () => join(cwd, '.agentteams', 'config.json');
  const claudeConfigPath = () => join(home, '.claude.json');
  const cursorConfigPath = () => join(home, '.cursor', 'mcp.json');

  function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  }

  function seedProject(authMode: 'personal-token' | null = 'personal-token'): void {
    writeJson(projectConfigPath(), {
      teamId: 'team-fixture',
      projectId: 'project-fixture',
      apiUrl: 'https://api.agentteams.run',
      ...(authMode ? { authMode } : {}),
      apiKey: CANARY_API_KEY,
      customField: 'preserve-me',
    });
  }

  function seedClientCopies(): void {
    writeJson(claudeConfigPath(), {
      mcpServers: {
        other: { command: 'other' },
        agentteams: {
          type: 'stdio',
          command: 'agentteams',
          args: ['mcp'],
          env: { AGENTTEAMS_API_KEY: CANARY_API_KEY },
        },
      },
    });
    writeJson(cursorConfigPath(), {
      mcpServers: {
        agentteams: {
          command: 'agentteams',
          args: ['mcp'],
          env: { AGENTTEAMS_API_KEY: CANARY_API_KEY },
        },
      },
    });
    writeFileSync(`${claudeConfigPath()}${BACKUP_SUFFIX}`, readFileSync(claudeConfigPath()));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentteams-mcp-doctor-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'agentteams-mcp-doctor-cwd-'));
    // A PATH with a global `agentteams`, i.e. the machine the bare-executable spec assumes.
    bin = mkdtempSync(join(tmpdir(), 'agentteams-mcp-doctor-bin-'));
    writeFileSync(join(bin, 'agentteams'), '', 'utf-8');
    context = { homeDir: home, cwd, env: { PATH: bin } as NodeJS.ProcessEnv };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it('finds project, Claude, Cursor, and backup copies without exposing the key or changing files', async () => {
    seedProject();
    seedClientCopies();
    const paths = [
      projectConfigPath(),
      claudeConfigPath(),
      cursorConfigPath(),
      `${claudeConfigPath()}${BACKUP_SUFFIX}`,
    ];
    const before = Object.fromEntries(paths.map((path) => [path, hash(path)]));

    const output = await runMcpDoctorCommand({ yes: false }, { context });
    const report = output.json as McpDoctorReport;

    expect(report.findings.map((finding) => finding.path)).toEqual(expect.arrayContaining(paths));
    expect(report.findings).toHaveLength(4);
    expect(report.confirmed).toBe(false);
    expect(output.text).toContain('no files were changed');
    expect(output.text).toContain('--yes');
    expect(output.text).not.toContain(CANARY_API_KEY);
    expect(JSON.stringify(output.json)).not.toContain(CANARY_API_KEY);
    expect(Object.fromEntries(paths.map((path) => [path, hash(path)]))).toEqual(before);
  });

  it('cleans confirmed copies, preserves unrelated fields, and reports no remaining key material', async () => {
    seedProject();
    seedClientCopies();

    const output = await runMcpDoctorCommand({ yes: true }, { context, hasValidPersonalCredential: async () => true });
    const report = output.json as McpDoctorReport;

    expect(JSON.parse(readFileSync(projectConfigPath(), 'utf-8'))).toEqual({
      teamId: 'team-fixture',
      projectId: 'project-fixture',
      apiUrl: 'https://api.agentteams.run',
      authMode: 'personal-token',
      customField: 'preserve-me',
    });
    expect(JSON.parse(readFileSync(claudeConfigPath(), 'utf-8'))).toEqual({
      mcpServers: {
        other: { command: 'other' },
        agentteams: { type: 'stdio', command: 'agentteams', args: ['mcp'], env: {} },
      },
    });
    expect(JSON.parse(readFileSync(cursorConfigPath(), 'utf-8')).mcpServers.agentteams).toEqual({
      command: 'agentteams',
      args: ['mcp'],
      env: {},
    });
    expect(existsSync(`${claudeConfigPath()}${BACKUP_SUFFIX}`)).toBe(false);
    expect(report.confirmed).toBe(true);
    expect(report.remainingFindings).toEqual([]);
    expect(output.exitCode).toBe(0);
    expect(output.text).not.toContain(CANARY_API_KEY);
    expect(JSON.stringify(output.json)).not.toContain(CANARY_API_KEY);
  });

  it('keeps the project apiKey and prints migration guidance when no valid personal credential exists', async () => {
    seedProject();

    const output = await runMcpDoctorCommand({ yes: true }, { context, hasValidPersonalCredential: async () => false });
    const report = output.json as McpDoctorReport;

    expect(JSON.parse(readFileSync(projectConfigPath(), 'utf-8')).apiKey).toBe(CANARY_API_KEY);
    expect(report.remainingFindings).toHaveLength(1);
    expect(output.text).toContain('agentteams auth login');
    expect(output.text).not.toContain(CANARY_API_KEY);
  });

  it('does not remove a project key before the project has opted into personal-token auth', async () => {
    seedProject(null);
    const hasValidPersonalCredential = jest.fn(async () => true);

    const output = await runMcpDoctorCommand({ yes: true }, { context, hasValidPersonalCredential });

    expect(JSON.parse(readFileSync(projectConfigPath(), 'utf-8')).apiKey).toBe(CANARY_API_KEY);
    expect(hasValidPersonalCredential).not.toHaveBeenCalled();
    expect(output.text).toContain('agentteams auth login');
  });

  it('never registers agentteams in a client config that does not already have the entry', async () => {
    writeJson(claudeConfigPath(), {
      mcpServers: { other: { command: 'other' } },
      projects: { '/some/repo': { history: [`agentteams init --api-key ${CANARY_API_KEY}`] } },
    });
    const before = readFileSync(claudeConfigPath(), 'utf-8');

    const output = await runMcpDoctorCommand({ yes: true }, { context });
    const report = output.json as McpDoctorReport;

    expect(readFileSync(claudeConfigPath(), 'utf-8')).toBe(before);
    expect(JSON.parse(before).mcpServers.agentteams).toBeUndefined();
    expect(existsSync(`${claudeConfigPath()}${BACKUP_SUFFIX}`)).toBe(false);
    expect(report.cleanup).toEqual([
      expect.objectContaining({ outcome: 'SKIPPED', detail: expect.stringContaining('not registered') }),
    ]);
    expect(output.text).not.toContain(CANARY_API_KEY);
  });

  it('ignores key_ substrings that are part of a longer identifier', async () => {
    writeJson(cursorConfigPath(), {
      mcpServers: {
        agentteams: { command: 'agentteams', args: ['mcp'], env: {} },
        other: { command: 'other', env: { LICENSE_KEY_PATH: '/etc/license_key_path', api_key_source: 'keychain' } },
      },
    });
    const before = readFileSync(cursorConfigPath(), 'utf-8');

    const output = await runMcpDoctorCommand({ yes: true }, { context });
    const report = output.json as McpDoctorReport;

    expect(readFileSync(cursorConfigPath(), 'utf-8')).toBe(before);
    expect(report.findings).toEqual([]);
    expect(output.exitCode).toBe(0);
  });

  it('reports an unrecognized client config without rewriting it', async () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const malformed = `{ "mcpServers": { "agentteams": { "env": { "AGENTTEAMS_API_KEY": "${CANARY_API_KEY}" } }`;
    writeFileSync(cursorConfigPath(), malformed, 'utf-8');

    const output = await runMcpDoctorCommand({ yes: true }, { context });

    expect(readFileSync(cursorConfigPath(), 'utf-8')).toBe(malformed);
    expect((output.json as McpDoctorReport).remainingFindings).toHaveLength(1);
    expect(output.text).toContain('left unchanged');
    expect(output.text).not.toContain(CANARY_API_KEY);
  });
});
