import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore } from '../src/auth/credentialStore.js';

let root: string;
let homeDir: string;
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;
let store: ReturnType<typeof createCredentialStore>;
const missingLogin =
  "This project is configured to use a personal login, but no credential is stored. Run 'agentteams auth login'.";
const conventionStatus = jest.fn(async () => ({
  conventionUpdateAvailable: false,
  platformGuidesChanged: false,
  cliUpdateAvailable: false,
  credentialProblem: missingLogin,
}));

jest.unstable_mockModule('../src/auth/credentialStore.js', () => ({
  getCredentialStore: () => store,
}));
jest.unstable_mockModule('../src/commands/convention.js', () => ({
  CONVENTION_DIR: '.agentteams',
  CONVENTION_INDEX_FILE: 'convention.md',
  conventionStatus,
  conventionDownload: jest.fn(),
  findProjectRoot: (cwd: string = process.cwd()) => (existsSync(join(cwd, '.agentteams', 'config.json')) ? cwd : null),
  readDeployedConventionPaths: () => [],
}));

const { executeAuthCommand, describeAuthStatusProblem, describeDeviceAuthConflict } =
  await import('../src/commands/auth.js');
const { executeDoctorCommand } = await import('../src/commands/doctor.js');
const { sessionSync } = await import('../src/commands/session.js');
const { CredentialResolutionError } = await import('../src/utils/config.js');
const { resetPersonalTokenClientsForTests } = await import('../src/auth/personalTokenClient.js');
const { createPersonalTokenStore } = await import('../src/auth/personalTokenStore.js');
const { loadConfigWithCredential } = await import('../src/utils/config.js');
const { formatAuthResultText } = await import('../src/utils/authFormat.js');
const { setDeviceAuthDefault, resolveDeviceAuthDefault } = await import('../src/utils/config.js');

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), 'onboarding-diagnostics-'));
  homeDir = join(root, 'home');
  mkdirSync(homeDir);
  mkdirSync(join(root, '.agentteams'));
  writeFileSync(
    join(root, '.agentteams/config.json'),
    JSON.stringify({
      teamId: 'team-test',
      projectId: 'project-test',
      authMode: 'personal-token',
      apiUrl: 'https://diagnostics.invalid',
    }),
    { mode: 0o600 },
  );
  writeFileSync(join(root, '.agentteams/convention.md'), '# Convention\n');
  for (const file of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(root, file), '# Agent\n');
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENTTEAMS_')) delete process.env[key];
  store = createCredentialStore({ homeDir, runner: () => ({ status: null, stdout: '', stderr: '' }) });
  resetPersonalTokenClientsForTests();
  process.chdir(root);
  conventionStatus.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.chdir(originalCwd);
  process.env = originalEnv;
  resetPersonalTokenClientsForTests();
  rmSync(root, { recursive: true, force: true });
});

describe('logout onboarding (O4, O14, O19)', () => {
  const readConfig = () => JSON.parse(readFileSync(join(root, '.agentteams/config.json'), 'utf8'));

  it('keeps personal-token mode and guides the next command back to login', async () => {
    const result = (await executeAuthCommand('logout')) as { serverTokenStatus: string };
    expect(readConfig().authMode).toBe('personal-token');
    await expect(loadConfigWithCredential()).rejects.toThrow('agentteams auth login');
    expect(await executeAuthCommand('status')).toMatchObject({ problem: missingLogin });
    expect(result.serverTokenStatus).toBe('not-stored');
    expect(formatAuthResultText('logout', result)).not.toContain('still valid');
  });

  it('only falls back when a legacy key is actually available', async () => {
    writeFileSync(join(root, '.agentteams/config.json'), JSON.stringify({ ...readConfig(), apiKey: 'key_legacy' }));
    expect(await executeAuthCommand('logout')).toMatchObject({ fellBackToApiKey: true });
    expect(readConfig().authMode).toBeUndefined();
    expect(readConfig().apiKey).toBe('key_legacy');
  });

  it('does not change this project when logging out of another server', async () => {
    const before = readFileSync(join(root, '.agentteams/config.json'), 'utf8');
    expect(await executeAuthCommand('logout', { apiUrl: 'https://other.invalid' })).toMatchObject({
      configPath: null,
      fellBackToApiKey: false,
      serverTokenStatus: 'not-stored',
    });
    expect(readFileSync(join(root, '.agentteams/config.json'), 'utf8')).toBe(before);
  });

  it('reports local-only removal without claiming that the server token is valid', async () => {
    createPersonalTokenStore('https://diagnostics.invalid', store).save('atr_test_refresh');
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const result = (await executeAuthCommand('logout', { local: true })) as Record<string, unknown>;
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.serverTokenStatus).toBe('local-only');
    const text = formatAuthResultText('logout', result);
    expect(text).toContain('not revoked');
    expect(text).not.toContain('still valid');
  });

  it('reports a confirmed revoke and preserves login mode', async () => {
    createPersonalTokenStore('https://diagnostics.invalid', store).save('atr_test_refresh');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    expect(await executeAuthCommand('logout')).toMatchObject({ serverTokenStatus: 'revoked', revokedOnServer: true });
    expect(readConfig().authMode).toBe('personal-token');
  });

  it('reports revoke failure and keeps the local credential for retry', async () => {
    const tokens = createPersonalTokenStore('https://diagnostics.invalid', store);
    tokens.save('atr_test_refresh');
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(executeAuthCommand('logout')).rejects.toThrow(/revocation failed.*local login was kept/);
    expect(tokens.read()).toBe('atr_test_refresh');
    expect(readConfig().authMode).toBe('personal-token');
  });
});

describe('onboarding credential diagnostics', () => {
  it('identifies the injected machine default and its one-run override (O10)', () => {
    setDeviceAuthDefault(true, homeDir);
    expect(resolveDeviceAuthDefault(homeDir)).toMatchObject({ enabled: true, source: 'machine-config' });
    const message = describeDeviceAuthConflict(false, homeDir);
    expect(message).toContain(join(homeDir, '.agentteams/config.json'));
    expect(message).toContain('Remove "deviceAuth"');
    expect(message).toContain('AGENTTEAMS_DEVICE_AUTH=0');
    process.env.AGENTTEAMS_DEVICE_AUTH = '0';
    expect(resolveDeviceAuthDefault(homeDir)).toMatchObject({ enabled: false, source: 'environment' });
  });

  it('preserves the missing-login cause instead of suggesting a network failure (O6)', async () => {
    const result = (await executeAuthCommand('status')) as { problem?: string };
    expect(result.problem).toBe(missingLogin);
    expect(result.problem).not.toMatch(/network|refresh/i);
  });

  it('keeps network, server and ended-login diagnoses distinct', () => {
    const state = {
      connected: true,
      persisted: true,
      storeBackend: 'protected-file' as const,
      storeReason: 'OK' as const,
      identity: null,
      expiresAt: null,
      reconnectRequired: false,
      refreshFailure: null,
    };
    for (const [refreshFailure, message] of [
      ['NETWORK', 'server could not be reached'],
      ['SERVER', 'temporarily'],
    ] as const) {
      expect(
        describeAuthStatusProblem(new CredentialResolutionError('unavailable'), { ...state, refreshFailure }, true),
      ).toContain(message);
    }
    expect(
      describeAuthStatusProblem(
        new CredentialResolutionError('unavailable'),
        {
          ...state,
          reconnectRequired: true,
          revokedReason: 'expired',
        },
        true,
      ),
    ).toContain('sign-in expired');
  });

  it('does not report READY without a personal credential (O15)', async () => {
    const result = await executeDoctorCommand({
      cwd: root,
      sessionHookDependencies: {
        context: { homeDir, env: { PATH: '' } },
        detectionDependencies: { fileExists: () => false },
      },
    });
    expect(result.status).toBe('DEGRADED');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('agentteams auth login') }),
    );
  });

  it('does not recommend API-key reissue for a keyless personal config (O15)', async () => {
    const { chmodSync } = await import('node:fs');
    chmodSync(join(root, '.agentteams/config.json'), 0o644);
    const result = await executeDoctorCommand({
      cwd: root,
      sessionHookDependencies: {
        context: { homeDir, env: { PATH: '' } },
        detectionDependencies: { fileExists: () => false },
      },
    });
    expect(result.issues.some(({ message }) => message.includes('Reissue the agent API key'))).toBe(false);
  });

  it('reports an uninitialized directory as not connected, not up to date (O18)', async () => {
    const result = await sessionSync({ cwd: homeDir });
    expect(result.summary).not.toContain('Up to date');
    expect(result.summary).toMatch(/not.*project|not.*connected/i);
  });

  it('reports a missing login once instead of repeating it for conventions and skills (O18)', async () => {
    const result = await sessionSync({ cwd: root });
    expect(result.notes.filter((note) => note.includes('agentteams auth login'))).toHaveLength(1);
    expect(result.summary).not.toContain('Up to date');
  });
});
