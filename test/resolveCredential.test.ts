import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CredentialResolutionError,
  describeUnusableCredential,
  loadConfigWithCredential,
  resetLegacyApiKeyWarningForTest,
  resolveCredential,
  type ResolveCredentialDeps,
} from '../src/utils/config.js';
import { PersonalTokenClient } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenState } from '../src/auth/personalTokenClient.js';
import {
  getActiveCredential,
  getInjectedPersonalTokenRefreshBlockReason,
  resetActiveCredentialForTests,
} from '../src/auth/activeCredential.js';
import type { PersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { buildAuthHeaders } from '../src/utils/apiContext.js';

const API_URL = 'https://api.agentteams.run';

const tempDirs: string[] = [];
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;

function createProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-credential-test-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify(config), 'utf-8');
  process.chdir(root);
  return root;
}

function tokenStore(value: string | null): PersonalTokenStore & { removals: number } {
  const state = {
    value,
    removals: 0,
    status: () => ({ backend: 'macos-keychain' as const, persisted: true, reason: 'OK' as const }),
    read: () => state.value,
    save: (token: string) => {
      state.value = token;
      return { persisted: true, reason: 'OK' as const };
    },
    remove: () => {
      state.removals += 1;
      state.value = null;
    },
  };
  return state;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tokenPayload = {
  data: {
    accessToken: 'atp_personal_access',
    refreshToken: 'atr_rotated',
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
  },
};

/** A deps object whose client is backed by a scripted fetch, so nothing touches a real keychain. */
function clientDeps(
  store: PersonalTokenStore,
  fetchImpl: typeof fetch,
): ResolveCredentialDeps & { calls: () => number } {
  let calls = 0;
  const client = new PersonalTokenClient({
    apiUrl: API_URL,
    store,
    fetch: fetchImpl,
    now: () => 0,
  });
  return {
    getClient: () => {
      calls += 1;
      return client;
    },
    calls: () => calls,
  };
}

const workingFetch = (async () => jsonResponse(200, tokenPayload)) as unknown as typeof fetch;

const unusableCredentialState = (overrides: Partial<PersonalTokenState> = {}): PersonalTokenState => ({
  connected: true,
  persisted: true,
  storeBackend: 'macos-keychain',
  storeReason: 'OK',
  identity: null,
  expiresAt: null,
  reconnectRequired: false,
  refreshFailure: 'NETWORK',
  ...overrides,
});

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  resetActiveCredentialForTests();
  delete process.env.AGENTTEAMS_API_KEY;
  delete process.env.AGENTTEAMS_TEAM_ID;
  delete process.env.AGENTTEAMS_PROJECT_ID;
  delete process.env.AGENTTEAMS_API_URL;
  delete process.env.AGENTTEAMS_MCP_MEMBER_ID;
});

afterEach(() => {
  resetActiveCredentialForTests();
  process.chdir(originalCwd);
  process.env = originalEnv;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('resolveCredential priority', () => {
  it('prefers an explicit --api-key over everything else', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_from_config' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    const credential = await resolveCredential({ apiKey: 'key_explicit' }, deps);

    expect(credential).toEqual({ source: 'explicit-api-key', apiKey: 'key_explicit' });
    // The keychain is never consulted when the caller already named a credential.
    expect(deps.calls()).toBe(0);
  });

  it('prefers AGENTTEAMS_API_KEY over the stored personal token', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    process.env.AGENTTEAMS_API_KEY = 'key_from_env';
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    expect(await resolveCredential(undefined, deps)).toEqual({
      source: 'explicit-api-key',
      apiKey: 'key_from_env',
    });
    expect(deps.calls()).toBe(0);
  });

  it('uses the personal token when the project opted in, even with a key_ present', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy', authMode: 'personal-token' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    const credential = await resolveCredential(undefined, deps);

    expect(credential?.source).toBe('personal-token');
    expect(credential?.apiKey).toBe('atp_personal_access');
    expect(credential?.expiresAt).toBe(900_000);
  });

  it('falls back to the config key_ when nothing else applies', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    expect(await resolveCredential(undefined, deps)).toEqual({
      source: 'config-api-key',
      apiKey: 'key_legacy',
    });
  });

  it('returns null when there is no credential of any kind', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    const deps = clientDeps(tokenStore(null), workingFetch);

    expect(await resolveCredential(undefined, deps)).toBeNull();
  });
});

describe('resolveCredential refresh registration', () => {
  it('arms the 401 retry for an injected atp_ when the stored CLI login belongs to the same member', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    process.env.AGENTTEAMS_MCP_MEMBER_ID = 'm-1';
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    expect(await resolveCredential(undefined, deps)).toEqual({
      source: 'explicit-api-key',
      apiKey: 'atp_desktop_snapshot',
      refreshable: true,
    });
    expect(getActiveCredential()).not.toBeNull();
    expect(deps.calls()).toBe(1);
  });

  it('leaves an injected atp_ static when Desktop did not provide an identity', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    expect(await resolveCredential(undefined, deps)).toEqual({
      source: 'explicit-api-key',
      apiKey: 'atp_desktop_snapshot',
    });
    expect(getActiveCredential()).toBeNull();
    expect(getInjectedPersonalTokenRefreshBlockReason()).toBe('IDENTITY_MISSING');
    expect(deps.calls()).toBe(0);
  });

  it('leaves an injected atp_ static when no CLI credential is stored', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    process.env.AGENTTEAMS_MCP_MEMBER_ID = 'm-1';

    await resolveCredential(undefined, clientDeps(tokenStore(null), workingFetch));

    expect(getActiveCredential()).toBeNull();
    expect(getInjectedPersonalTokenRefreshBlockReason()).toBe('CLI_CREDENTIAL_MISSING');
  });

  it('fails closed when the injected token and stored CLI login belong to different members', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    process.env.AGENTTEAMS_MCP_MEMBER_ID = 'different-member';

    await expect(resolveCredential(undefined, clientDeps(tokenStore('atr_stored'), workingFetch))).rejects.toThrow(
      /different members/,
    );
    expect(getActiveCredential()).toBeNull();
    expect(getInjectedPersonalTokenRefreshBlockReason()).toBe('IDENTITY_MISMATCH');
  });

  it('keeps an injected key_ static and sends it through X-API-Key', async () => {
    createProject({ teamId: 't', projectId: 'p' });
    process.env.AGENTTEAMS_API_KEY = 'key_from_desktop';

    const credential = await resolveCredential(undefined, clientDeps(tokenStore('atr_stored'), workingFetch));

    expect(getActiveCredential()).toBeNull();
    expect(buildAuthHeaders(credential?.apiKey ?? '')).toEqual({ 'X-API-Key': 'key_from_desktop' });
  });

  it('arms the 401 retry for a stored personal login', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });

    await resolveCredential(undefined, clientDeps(tokenStore('atr_stored'), workingFetch));

    expect(getActiveCredential()).not.toBeNull();
  });
});

describe('resolveCredential and the legacy key_ path', () => {
  it('prints migration guidance to stderr only once per execution', async () => {
    resetLegacyApiKeyWarningForTest();
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy' });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await resolveCredential(undefined, clientDeps(tokenStore(null), workingFetch));
      await resolveCredential(undefined, clientDeps(tokenStore(null), workingFetch));

      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls[0]?.[0]).toContain('agentteams auth login');
      expect(stderr.mock.calls[0]?.[0]).toContain('key_');
    } finally {
      stderr.mockRestore();
    }
  });

  it('never consults the credential store for a plain key_ project', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    await resolveCredential(undefined, deps);

    expect(deps.calls()).toBe(0);
  });

  it('keeps working when the personal token cannot be refreshed but a key_ exists', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy', authMode: 'personal-token' });
    const store = tokenStore('atr_stored');
    const deps = clientDeps(store, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);

    expect(await resolveCredential(undefined, deps)).toEqual({
      source: 'config-api-key',
      apiKey: 'key_legacy',
    });
    expect(store.removals).toBe(0);
  });

  it('sends a legacy key_ on X-API-Key and a personal token on Authorization', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy' });
    const legacy = await resolveCredential(undefined, clientDeps(tokenStore(null), workingFetch));
    expect(buildAuthHeaders(legacy?.apiKey ?? '')).toEqual({ 'X-API-Key': 'key_legacy' });

    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const personal = await resolveCredential(undefined, clientDeps(tokenStore('atr_stored'), workingFetch));
    expect(buildAuthHeaders(personal?.apiKey ?? '')).toEqual({
      Authorization: 'Bearer atp_personal_access',
    });
  });
});

describe('resolveCredential failure reporting', () => {
  it('points an unconnected directory at the project binding when the login is usable', () => {
    const message = describeUnusableCredential(unusableCredentialState({ refreshFailure: null }), {
      projectConnected: false,
    });

    expect(message.toLowerCase()).not.toContain('network');
    expect(message).toContain('project directory');
    expect(message).toContain('agentteams init');
  });

  it('preserves the existing revoked and lock failure messages byte-for-byte', () => {
    expect(describeUnusableCredential(unusableCredentialState({ reconnectRequired: true }))).toBe(
      "Your AgentTeams login was revoked or expired. Run 'agentteams auth login' to sign in again.",
    );
    expect(describeUnusableCredential(unusableCredentialState({ refreshFailure: 'LOCK_CONTENTION' }))).toBe(
      'Another agentteams process is refreshing this login and did not finish in time. Your credential is intact — retry the command.',
    );
    expect(describeUnusableCredential(unusableCredentialState({ refreshFailure: 'LOCK_UNAVAILABLE' }))).toBe(
      'Could not maintain the lock that keeps concurrent logins from clashing (check free space and permissions on ~/.agentteams/locks). Your credential is intact — retry the command.',
    );
    expect(describeUnusableCredential(unusableCredentialState())).toBe(
      "Could not refresh your AgentTeams login. Check your network connection, then retry or run 'agentteams auth login'.",
    );
  });

  it('tells the user to log in again when the server revoked the refresh token', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const deps = clientDeps(tokenStore('atr_stored'), (async () =>
      jsonResponse(401, { error: 'invalid_grant' })) as unknown as typeof fetch);

    await expect(resolveCredential(undefined, deps)).rejects.toBeInstanceOf(CredentialResolutionError);
    await expect(resolveCredential(undefined, deps)).rejects.toThrow(/auth login/);
  });

  it('distinguishes an unreachable server from a revoked login', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const deps = clientDeps(tokenStore('atr_stored'), (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch);

    await expect(resolveCredential(undefined, deps)).rejects.toThrow(/network connection/);
  });

  it('explains an opted-in project that has no stored credential', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const deps = clientDeps(tokenStore(null), workingFetch);

    await expect(resolveCredential(undefined, deps)).rejects.toThrow(/no credential is stored/);
  });

  it('routes the document `agentteams init` writes to auth login, not to a re-init', async () => {
    // The exact default-init config (see toConfig in commands/init.ts): no apiKey, and the
    // authMode marker. Drop the marker and this project silently returns null instead, so
    // `auth logout` / a fresh clone / a wiped keychain all report "run `agentteams init`
    // first" — advice that is wrong for an already-configured project.
    createProject({ teamId: 't', projectId: 'p', apiUrl: API_URL, authMode: 'personal-token' });
    const deps = clientDeps(tokenStore(null), workingFetch);

    await expect(resolveCredential(undefined, deps)).rejects.toThrow(/agentteams auth login/);
  });
});

describe('loadConfigWithCredential', () => {
  it('substitutes the personal access token into apiKey so downstream code is unchanged', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    const config = await loadConfigWithCredential(undefined, deps);

    expect(config).toMatchObject({
      teamId: 't',
      projectId: 'p',
      apiKey: 'atp_personal_access',
      apiUrl: API_URL,
      credentialSource: 'personal-token',
    });
  });

  it('returns the legacy config verbatim for a key_ project', async () => {
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy' });

    const config = await loadConfigWithCredential(undefined, clientDeps(tokenStore(null), workingFetch));

    expect(config).toMatchObject({
      teamId: 't',
      projectId: 'p',
      apiKey: 'key_legacy',
      credentialSource: 'config-api-key',
    });
  });

  it('returns null when teamId or projectId is missing, before touching any credential', async () => {
    createProject({ projectId: 'p', apiKey: 'key_legacy' });
    const deps = clientDeps(tokenStore('atr_stored'), workingFetch);

    expect(await loadConfigWithCredential(undefined, deps)).toBeNull();
    expect(deps.calls()).toBe(0);
  });

  it('resolves the token once per call rather than per consumer', async () => {
    createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload));
    const deps = clientDeps(tokenStore('atr_stored'), fetchMock as unknown as typeof fetch);

    await loadConfigWithCredential(undefined, deps);
    await loadConfigWithCredential(undefined, deps);

    // The second call reuses the cached, unexpired access token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
