import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPersonalTokenAuthorizeUrl,
  describeAuthStatusProblem,
  executeAuthCommand,
  resolveAuthApiUrl,
} from '../src/commands/auth.js';
import { resetCredentialStoreForTests } from '../src/auth/credentialStore.js';
import { resetPersonalTokenClientsForTests } from '../src/auth/personalTokenClient.js';
import { createPkcePair, startAuthorizationCodeServer } from '../src/utils/authServer.js';
import { CredentialResolutionError, setProjectAuthMode } from '../src/utils/config.js';
import { PersonalTokenClient, PersonalTokenError } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenState } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenStore } from '../src/auth/personalTokenStore.js';

const tempDirs: string[] = [];
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;

function createProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-auth-test-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  process.chdir(root);
  return join(root, '.agentteams', 'config.json');
}

function readConfig(configPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
}

function tokenStore(value: string | null): PersonalTokenStore & { value: string | null; removals: number } {
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
    accessToken: 'atp_access',
    refreshToken: 'atr_refresh',
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
  },
};

const authStatusState = (overrides: Partial<PersonalTokenState> = {}): PersonalTokenState => ({
  connected: true,
  persisted: true,
  storeBackend: 'macos-keychain',
  storeReason: 'OK',
  identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
  expiresAt: Date.now() + 60_000,
  reconnectRequired: false,
  refreshFailure: null,
  ...overrides,
});

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('PKCE', () => {
  it('produces an S256 challenge inside the server-accepted length range', () => {
    const pair = createPkcePair();

    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.verifier.length).toBeLessThanOrEqual(128);
    expect(pair.challenge.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge.length).toBeLessThanOrEqual(128);
  });

  it('never repeats a verifier', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createPkcePair().verifier));
    expect(verifiers.size).toBe(50);
  });
});

describe('authorize URL', () => {
  it('carries the state and the challenge, and never the verifier', () => {
    const pair = createPkcePair();
    const url = new URL(
      buildPersonalTokenAuthorizeUrl({
        port: 5555,
        state: 'state-value-1234567890',
        codeChallenge: pair.challenge,
        projectName: 'demo',
      }),
    );

    expect(url.pathname).toBe('/cli/authorize');
    expect(url.searchParams.get('port')).toBe('5555');
    expect(url.searchParams.get('state')).toBe('state-value-1234567890');
    expect(url.searchParams.get('code_challenge')).toBe(pair.challenge);
    expect(url.toString()).not.toContain(pair.verifier);
  });
});

describe('startAuthorizationCodeServer', () => {
  const postCallback = async (port: number, body: unknown, origin = 'https://agentteams.run') =>
    fetch(`http://localhost:${port}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });

  it('accepts only { code, state } with a matching state', async () => {
    const context = await startAuthorizationCodeServer({ state: 'expected-state-0123456789' });
    const pending = context.waitForCallback();

    const response = await postCallback(context.port, { code: 'atc_code', state: 'expected-state-0123456789' });

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({ code: 'atc_code', state: 'expected-state-0123456789' });
  });

  it('rejects a mismatched state without consuming the login', async () => {
    const context = await startAuthorizationCodeServer({ state: 'expected-state-0123456789' });
    const pending = context.waitForCallback();

    const forged = await postCallback(context.port, { code: 'atc_forged', state: 'someone-elses-state-000' });
    expect(forged.status).toBe(400);

    // The real callback still works: a forged one must not be a denial of service.
    const real = await postCallback(context.port, { code: 'atc_real', state: 'expected-state-0123456789' });
    expect(real.status).toBe(200);
    await expect(pending).resolves.toMatchObject({ code: 'atc_real' });
  });

  it('rejects a callback from an origin that is not the configured web app', async () => {
    const context = await startAuthorizationCodeServer({ state: 'expected-state-0123456789' });
    context.waitForCallback().catch(() => undefined);

    const response = await postCallback(
      context.port,
      { code: 'atc_code', state: 'expected-state-0123456789' },
      'http://evil.example',
    );

    expect(response.status).toBe(403);
    context.server.close();
  });

  it('rejects a payload with no code', async () => {
    const context = await startAuthorizationCodeServer({ state: 'expected-state-0123456789' });
    context.waitForCallback().catch(() => undefined);

    const response = await postCallback(context.port, { state: 'expected-state-0123456789' });

    expect(response.status).toBe(400);
    context.server.close();
  });
});

describe('authorization code exchange', () => {
  it('fails when the code is redeemed without the verifier the server hashed', async () => {
    // The server compares sha256(codeVerifier) with the stored challenge, so a
    // code stolen from the browser is useless without this process's verifier.
    const fetchMock = jest.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { codeVerifier?: string };
      return body.codeVerifier === 'the-real-verifier'
        ? jsonResponse(200, tokenPayload)
        : jsonResponse(401, { error: 'invalid_grant' });
    });

    const store = tokenStore(null);
    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'atc_code',
        codeVerifier: 'a-different-verifier',
        redirectUri: 'http://localhost:5555/callback',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });
    expect(store.value).toBeNull();

    await expect(
      client.exchangeAuthorizationCode({
        code: 'atc_code',
        codeVerifier: 'the-real-verifier',
        redirectUri: 'http://localhost:5555/callback',
      }),
    ).resolves.toMatchObject({ accessToken: 'atp_access' });
    expect(store.value).toBe('atr_refresh');
  });
});

describe('a login that cannot be stored', () => {
  /** A backend that looks present but refuses the write — a locked keychain. */
  const unstorableStore = (): PersonalTokenStore & { value: string | null; removals: number } => {
    const state = {
      value: null as string | null,
      removals: 0,
      status: () => ({ backend: 'macos-keychain' as const, persisted: false, reason: 'WRITE_FAILED' as const }),
      read: () => state.value,
      save: (token: string) => {
        // The store still hands the value back for this process, which is why
        // `read()` keeps working — it just will not survive the process.
        state.value = token;
        return { persisted: false, reason: 'WRITE_FAILED' as const, detail: 'User interaction is not allowed.' };
      },
      remove: () => {
        state.removals += 1;
        state.value = null;
      },
    };
    return state;
  };

  it('revokes the token it just received instead of leaving an orphan on the server', async () => {
    const calls: string[] = [];
    const fetchMock = jest.fn(async (url: unknown) => {
      calls.push(String(url));
      return String(url).endsWith('/revoke') ? new Response(null, { status: 204 }) : jsonResponse(200, tokenPayload);
    });

    const store = unstorableStore();
    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'atc_code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost:5555/callback',
      }),
    ).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });

    expect(calls.some((url) => url.endsWith('/api/auth/desktop/revoke'))).toBe(true);
    // Nothing is left claiming to be a login the next process could use.
    expect(store.value).toBeNull();
    expect(client.hasCredential()).toBe(false);
  });

  it('still clears the local credential when the revoke cannot be delivered', async () => {
    const fetchMock = jest.fn(async (url: unknown) =>
      String(url).endsWith('/revoke') ? jsonResponse(500, { message: 'boom' }) : jsonResponse(200, tokenPayload),
    );

    const store = unstorableStore();
    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'atc_code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost:5555/callback',
      }),
    ).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });

    expect(store.value).toBeNull();
  });

  it('keeps a long-running session alive when a mid-session rotation cannot be stored', async () => {
    // The opposite call site: `agentteams mcp` rotating its refresh token must
    // not be logged out just because the keychain went away.
    const store = unstorableStore();
    store.value = 'atr_existing';

    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: (async () => jsonResponse(200, tokenPayload)) as unknown as typeof fetch,
    });

    await expect(client.getAccessToken()).resolves.toBe('atp_access');
    expect(client.hasCredential()).toBe(true);
    expect(client.state().storeReason).toBe('WRITE_FAILED');
  });
});

describe('logout ordering', () => {
  it('keeps the local credential when the server refuses to revoke', async () => {
    const store = tokenStore('atr_refresh');
    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: (async () => jsonResponse(500, { message: 'boom' })) as unknown as typeof fetch,
    });

    await expect(client.revoke()).rejects.toBeInstanceOf(PersonalTokenError);
    expect(store.value).toBe('atr_refresh');
    expect(store.removals).toBe(0);
  });

  it('removes it once the server accepts', async () => {
    const store = tokenStore('atr_refresh');
    const client = new PersonalTokenClient({
      apiUrl: 'https://api.agentteams.run',
      store,
      fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });

    await client.revoke();
    expect(store.value).toBeNull();
  });
});

describe('project auth mode', () => {
  it('opts a project in and back out without disturbing other fields', () => {
    const configPath = createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy', apiUrl: 'https://x.test' });

    expect(setProjectAuthMode(configPath, 'personal-token')).toBe(true);
    expect(readConfig(configPath)).toEqual({
      teamId: 't',
      projectId: 'p',
      apiKey: 'key_legacy',
      apiUrl: 'https://x.test',
      authMode: 'personal-token',
    });

    // Logout reverts the project, so a key_ that is still on disk takes over again.
    expect(setProjectAuthMode(configPath, null)).toBe(true);
    expect(readConfig(configPath)).toEqual({
      teamId: 't',
      projectId: 'p',
      apiKey: 'key_legacy',
      apiUrl: 'https://x.test',
    });
  });

  it('preserves fields this CLI version does not know about', () => {
    const configPath = createProject({ teamId: 't', projectId: 'p', futureField: { nested: true } });

    setProjectAuthMode(configPath, 'personal-token');

    expect(readConfig(configPath).futureField).toEqual({ nested: true });
  });

  it('reports failure instead of creating a config that does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentteams-auth-test-'));
    tempDirs.push(root);

    expect(setProjectAuthMode(join(root, '.agentteams', 'config.json'), 'personal-token')).toBe(false);
  });
});

describe('escaping the personal-token path', () => {
  beforeEach(() => {
    resetPersonalTokenClientsForTests();
    resetCredentialStoreForTests();
    // A per-run server keeps the credential slot unique, so a developer who is
    // actually logged in does not turn these into flaky tests.
    process.env.AGENTTEAMS_API_URL = `https://auth-cmd-${process.pid}.invalid`;
    delete process.env.AGENTTEAMS_API_KEY;
  });

  afterEach(() => {
    resetPersonalTokenClientsForTests();
    resetCredentialStoreForTests();
  });

  it('reverts authMode when no credential is stored, instead of trapping the project', async () => {
    // authMode 'personal-token' with nothing stored fails every command. If
    // logout refused to run here the only way out would be editing the file.
    const configPath = createProject({ teamId: 't', projectId: 'p', authMode: 'personal-token' });

    const result = (await executeAuthCommand('logout')) as { success: true; warning?: string };

    expect(result.success).toBe(true);
    expect(result.warning).toContain('No AgentTeams login was stored');
    expect(readConfig(configPath).authMode).toBeUndefined();
  });

  it('refuses to log in to a server the project does not talk to', async () => {
    // The refresh token is filed under the server that issued it, so this would
    // report success and then break the very next command.
    createProject({ teamId: 't', projectId: 'p', apiUrl: `https://auth-cmd-${process.pid}.invalid` });

    await expect(executeAuthCommand('login', { apiUrl: 'https://somewhere-else.invalid' })).rejects.toThrow(
      /would be stored where no command looks for it/,
    );
  });
});

describe('resolveAuthApiUrl', () => {
  it('prefers an explicit flag, then the environment, then the project config', () => {
    createProject({ teamId: 't', projectId: 'p', apiUrl: 'https://project.example' });

    delete process.env.AGENTTEAMS_API_URL;
    expect(resolveAuthApiUrl()).toBe('https://project.example');
    expect(resolveAuthApiUrl({ apiUrl: 'https://flag.example/' })).toBe('https://flag.example');

    process.env.AGENTTEAMS_API_URL = 'https://env.example';
    expect(resolveAuthApiUrl()).toBe('https://env.example');
  });

  it('falls back to the production API when nothing is configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentteams-auth-test-'));
    tempDirs.push(root);
    process.chdir(root);
    delete process.env.AGENTTEAMS_API_URL;

    expect(resolveAuthApiUrl()).toBe('https://api.agentteams.run');
  });
});

describe('auth status problem priority outside a project', () => {
  const resolutionError = new CredentialResolutionError('credential unavailable');

  it.each([
    ['revoked login', authStatusState({ reconnectRequired: true }), 'auth login'],
    ['lock contention', authStatusState({ refreshFailure: 'LOCK_CONTENTION' }), 'Another agentteams process'],
    ['lock unavailable', authStatusState({ refreshFailure: 'LOCK_UNAVAILABLE' }), 'free space and permissions'],
    ['network failure', authStatusState({ refreshFailure: 'NETWORK' }), 'network connection'],
  ])('keeps the concrete %s guidance', (_label, state, expected) => {
    const problem = describeAuthStatusProblem(resolutionError, state, false);

    expect(problem).toContain(expected);
    expect(problem).not.toContain('agentteams init');
  });

  it('uses project binding guidance when the login is otherwise usable', () => {
    const problem = describeAuthStatusProblem(undefined, authStatusState(), false);

    expect(problem).toContain('project directory');
    expect(problem).toContain('agentteams init');
  });
});
