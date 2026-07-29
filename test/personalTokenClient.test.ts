import { describe, expect, it, jest } from '@jest/globals';
import { PersonalTokenClient, PersonalTokenError } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { createCredentialStore } from '../src/auth/credentialStore.js';
import { createPersonalTokenStore } from '../src/auth/personalTokenStore.js';

const API_URL = 'https://api.agentteams.run';
const IDENTITY = { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' };

function fakeStore(initial: string | null = null): PersonalTokenStore & { value: string | null; removals: number } {
  const state = {
    value: initial,
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

const tokenPayload = (overrides: Partial<{ accessToken: string; refreshToken: string; expiresIn: number }> = {}) => ({
  data: {
    accessToken: overrides.accessToken ?? 'atp_access_1',
    refreshToken: overrides.refreshToken ?? 'atr_refresh_1',
    tokenType: 'Bearer',
    expiresIn: overrides.expiresIn ?? 900,
    refreshExpiresIn: 2_592_000,
    identity: IDENTITY,
  },
});

describe('PersonalTokenClient authorization code exchange', () => {
  it('stores only the refresh token and keeps the access token in memory', async () => {
    const store = fakeStore();
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({
      apiUrl: `${API_URL}/`,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 1_000,
    });

    const session = await client.exchangeAuthorizationCode({
      code: 'atc_code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'http://127.0.0.1:5555/callback',
    });

    expect(session.accessToken).toBe('atp_access_1');
    expect(session.expiresAt).toBe(1_000 + 900_000);
    expect(session.identity).toEqual(IDENTITY);
    expect(store.value).toBe('atr_refresh_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The trailing slash on apiUrl must not produce a double slash.
    expect(url).toBe(`${API_URL}/api/auth/desktop/token`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      grantType: 'authorization_code',
      clientId: 'agentteams-cli',
      code: 'atc_code',
      codeVerifier: 'v'.repeat(43),
    });
  });

  it('reports a rejected authorization code as INVALID_GRANT', async () => {
    const store = fakeStore();
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => jsonResponse(401, { error: 'invalid_grant' })) as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode({
        code: 'atc_x',
        codeVerifier: 'v'.repeat(43),
        redirectUri: 'http://x/callback',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });
    expect(store.value).toBeNull();
  });
});

describe('PersonalTokenClient access token lifecycle', () => {
  it('refreshes pre-emptively inside the 60s skew window', async () => {
    const store = fakeStore('atr_refresh_0');
    let now = 0;
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload({ accessToken: 'atp_fresh' })));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => now,
    });

    expect(await client.getAccessToken()).toBe('atp_fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Well inside the token's life: served from memory.
    now = 800_000;
    expect(await client.getAccessToken()).toBe('atp_fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 59s before expiry — inside the skew, so it refreshes rather than risking the race.
    now = 900_000 - 59_000;
    expect(await client.getAccessToken()).toBe('atp_fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses five concurrent requests into a single refresh', async () => {
    const store = fakeStore('atr_refresh_0');
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
    });

    const pending = Promise.all(Array.from({ length: 5 }, () => client.getAccessToken()));
    await Promise.resolve();
    resolveFetch?.(jsonResponse(200, tokenPayload({ accessToken: 'atp_once' })));

    expect(await pending).toEqual(Array.from({ length: 5 }, () => 'atp_once'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the stored refresh token and persists the rotated one', async () => {
    const store = fakeStore('atr_refresh_0');
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload({ refreshToken: 'atr_refresh_rotated' })));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
    });

    await client.getAccessToken();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      grantType: 'refresh_token',
      clientId: 'agentteams-cli',
      refreshToken: 'atr_refresh_0',
    });
    expect(store.value).toBe('atr_refresh_rotated');
  });

  it('returns null without a stored credential and never calls the server', async () => {
    const store = fakeStore(null);
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PersonalTokenClient failure classification', () => {
  it('clears the credential when the server explicitly rejects the refresh token', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => jsonResponse(401, { error: 'invalid_grant', reason: 'ROTATED' })) as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(store.value).toBeNull();
    expect(store.removals).toBe(1);
    expect(client.state().reconnectRequired).toBe(true);
  });

  it('keeps the credential when the network fails', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(store.value).toBe('atr_refresh_0');
    expect(store.removals).toBe(0);
    expect(client.state().reconnectRequired).toBe(false);
  });

  it('keeps the credential when the server returns a 5xx', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => jsonResponse(503, { message: 'upstream unavailable' })) as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(store.value).toBe('atr_refresh_0');
    expect(store.removals).toBe(0);
  });

  it('keeps the credential when a proxy returns an unparseable body', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(store.removals).toBe(0);
  });

  it('keeps the credential when a 200 response is missing token fields', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => jsonResponse(200, { data: { accessToken: 'atp_x' } })) as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(store.removals).toBe(0);
  });
});

describe('PersonalTokenClient revoke', () => {
  it('deletes the local credential only after the server accepts the revocation', async () => {
    const store = fakeStore('atr_refresh_0');
    const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.revoke();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/auth/desktop/revoke`);
    expect(JSON.parse(String(init.body))).toEqual({ clientId: 'agentteams-cli', token: 'atr_refresh_0' });
    expect(store.value).toBeNull();
  });

  it('keeps the local credential when the server refuses the revocation', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => jsonResponse(500, { message: 'boom' })) as unknown as typeof fetch,
    });

    await expect(client.revoke()).rejects.toBeInstanceOf(PersonalTokenError);
    expect(store.value).toBe('atr_refresh_0');
    expect(store.removals).toBe(0);
  });

  it('keeps the local credential when the server cannot be reached', async () => {
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => {
        throw new Error('ENOTFOUND');
      }) as unknown as typeof fetch,
    });

    await expect(client.revoke()).rejects.toMatchObject({ code: 'REVOKE_FAILED' });
    expect(store.value).toBe('atr_refresh_0');
  });

  it('reports NOT_LOGGED_IN instead of pretending to revoke nothing', async () => {
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store: fakeStore(null),
      fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });

    await expect(client.revoke()).rejects.toMatchObject({ code: 'NOT_LOGGED_IN' });
  });
});

describe('personalTokenStore', () => {
  it('scopes the credential slot per API server', () => {
    const reads: string[] = [];
    const backing = createCredentialStore({
      platform: 'darwin',
      runner: (command) => {
        if (command.args.includes('list-keychains')) return { status: 0, stdout: '', stderr: '' };
        reads.push(command.args[2] ?? '');
        return { status: 44, stdout: '', stderr: '' };
      },
    });

    createPersonalTokenStore('https://api.agentteams.run/', backing).read();
    createPersonalTokenStore('https://dev-api.agentteams.run', backing).read();

    expect(reads).toEqual([
      'personal-refresh:https://api.agentteams.run',
      'personal-refresh:https://dev-api.agentteams.run',
    ]);
  });
});
