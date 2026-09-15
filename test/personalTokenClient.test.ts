import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalTokenClient, PersonalTokenError, TOKEN_REQUEST_TIMEOUT_MS } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { createCredentialStore, type CommandRunner, type CredentialReadOptions } from '../src/auth/credentialStore.js';
import { createPersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { DEFAULT_STALE_AFTER_MS, RefreshLockTimeoutError, type RefreshLock } from '../src/auth/refreshLock.js';

const API_URL = 'https://api.agentteams.run';
const posixIt = process.platform === 'win32' ? it.skip : it;
const IDENTITY = { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' };

type FakeStore = PersonalTokenStore & {
  /** What the backend holds — i.e. what every other process sees. */
  value: string | null;
  /**
   * A superseded copy served to cached (non-fresh) reads, standing in for the
   * store's process-lifetime cache after another process has rotated.
   */
  cached?: string;
  reads: boolean[];
  removals: number;
  access: import('../src/auth/personalTokenClient.js').PersonalTokenSession | null;
};

function fakeStore(initial: string | null = null): FakeStore {
  const state: FakeStore = {
    value: initial,
    access: null,
    readAccess: () => state.access,
    saveAccess: (session) => {
      state.access = session;
    },
    removeAccess: () => {
      state.access = null;
    },
    reads: [],
    removals: 0,
    status: () => ({ backend: 'macos-keychain' as const, persisted: true, reason: 'OK' as const }),
    read: (options?: CredentialReadOptions) => {
      const fresh = options?.fresh === true;
      state.reads.push(fresh);
      return !fresh && state.cached !== undefined ? state.cached : state.value;
    },
    save: (token: string) => {
      state.value = token;
      state.cached = undefined;
      return { persisted: true, reason: 'OK' as const };
    },
    remove: () => {
      state.removals += 1;
      state.value = null;
      state.cached = undefined;
    },
  };
  return state;
}

/** Records how rotation interleaves with the lock it is supposed to hold. */
function recordingLock(order: string[]): RefreshLock {
  return {
    withLock: async (run) => {
      order.push('lock:acquire');
      try {
        return await run();
      } finally {
        order.push('lock:release');
      }
    },
  };
}

const timingOutLock: RefreshLock = {
  withLock: async () => {
    throw new RefreshLockTimeoutError('/tmp/personal-token.lock', 30_000);
  },
};

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
  it('refresh와 access 캐시를 분리해 저장한다', async () => {
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
    expect(store.access).toEqual(session);

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

/**
 * Rotation is destructive server-side: presenting an already-rotated refresh
 * token is reuse, and the server answers reuse by revoking the whole family.
 * Since one credential slot is shared by one-shot commands and a long-lived
 * `agentteams mcp`, rotation has to be serialized across processes and must
 * always send the token the slot actually holds.
 */
describe('PersonalTokenClient rotation against other processes', () => {
  it('sends the token from the backend, not a copy cached before another process rotated', async () => {
    const store = fakeStore('atr_rotated_by_mcp');
    // What this process read hours ago, and what the server has already revoked.
    store.cached = 'atr_stale';
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload({ refreshToken: 'atr_next' })));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
    });

    await client.getAccessToken();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ refreshToken: 'atr_rotated_by_mcp' });
    expect(store.value).toBe('atr_next');
  });

  it('rotates with the lock held, and releases it afterwards', async () => {
    const order: string[] = [];
    const store = fakeStore('atr_refresh_0');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: (async () => {
        order.push('rotate');
        return jsonResponse(200, tokenPayload());
      }) as unknown as typeof fetch,
      now: () => 0,
      lock: recordingLock(order),
    });

    await client.getAccessToken();

    expect(order).toEqual(['lock:acquire', 'rotate', 'lock:release']);
  });

  it('never takes the lock when there is no credential to rotate', async () => {
    const order: string[] = [];
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store: fakeStore(null),
      fetch: (async () => jsonResponse(200, tokenPayload())) as unknown as typeof fetch,
      lock: recordingLock(order),
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(order).toEqual([]);
  });

  it('gives up the rotation rather than racing when the lock cannot be taken', async () => {
    const store = fakeStore('atr_refresh_0');
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
      lock: timingOutLock,
    });

    expect(await client.getAccessToken()).toBeNull();
    // Treated like a network failure: nothing was sent, the credential survives,
    // and the next command retries instead of demanding a fresh login.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.value).toBe('atr_refresh_0');
    expect(store.removals).toBe(0);
    expect(client.state().reconnectRequired).toBe(false);
  });

  it('reports no credential when another process cleared the slot while waiting', async () => {
    const store = fakeStore(null);
    // This process still has a cached copy, but the backend no longer does —
    // a family already revoked and cleaned up elsewhere.
    store.cached = 'atr_stale';
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
    });

    expect(await client.getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes the token the slot actually holds', async () => {
    const store = fakeStore('atr_current');
    store.cached = 'atr_stale';
    const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.revoke();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ clientId: 'agentteams-cli', token: 'atr_current' });
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

  posixIt('reports the backend that holds this slot, not the one the machine prefers', () => {
    // After a fallback the two answers diverge: the keychain works again, but
    // this server's token is in the file. Naming the keychain here would send a
    // user to the wrong place to revoke it.
    const home = mkdtempSync(join(tmpdir(), 'agentteams-slot-status-'));
    try {
      const lockedKeychain: CommandRunner = (command) => {
        if (command.args.includes('list-keychains')) return { status: 0, stdout: '', stderr: '' };
        if (command.args.includes('find-generic-password'))
          return { status: 44, stdout: '', stderr: 'could not be found' };
        return { status: 1, stdout: '', stderr: 'User interaction is not allowed.' };
      };
      const duringOutage = createCredentialStore({ homeDir: home, platform: 'darwin', runner: lockedKeychain });
      expect(createPersonalTokenStore(API_URL, duringOutage).save('atr_stored_in_a_file')).toEqual({
        persisted: true,
        reason: 'OK',
      });

      // The keychain is healthy again in a later process, so the store-wide view
      // is "macOS keychain, fine" — but this one slot's token is still in a file.
      const healthyKeychain: CommandRunner = (command) => {
        if (command.args.includes('list-keychains')) return { status: 0, stdout: '', stderr: '' };
        return { status: 44, stdout: '', stderr: 'could not be found' };
      };
      const afterRecovery = createCredentialStore({ homeDir: home, platform: 'darwin', runner: healthyKeychain });

      expect(createPersonalTokenStore(API_URL, afterRecovery).status()).toMatchObject({
        backend: 'protected-file',
        persisted: true,
      });
      // A server that never fell back reports the OS store, as it should.
      expect(createPersonalTokenStore('https://other.invalid', afterRecovery).status().backend).toBe('macos-keychain');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('rotation with a file-backed credential', () => {
  /**
   * Rotation is already serialized by `createFileRefreshLock(slot)`. The file
   * backend has to live *inside* that lock rather than bring its own: a second
   * lock would either be redundant or, worse, order the two differently in two
   * processes and deadlock.
   */
  posixIt('rotates inside the existing slot lock and adds no lock of its own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agentteams-file-rotate-'));
    try {
      const lockedKeychain: CommandRunner = (command) => {
        if (command.args.includes('list-keychains')) return { status: 0, stdout: '', stderr: '' };
        if (command.args.includes('find-generic-password'))
          return { status: 44, stdout: '', stderr: 'could not be found' };
        return { status: 1, stdout: '', stderr: 'User interaction is not allowed.' };
      };
      const backing = createCredentialStore({ homeDir: home, platform: 'darwin', runner: lockedKeychain });
      const store = createPersonalTokenStore(API_URL, backing);
      store.save('atr_first');

      const held: string[] = [];
      const lock: RefreshLock = {
        withLock: async (run) => {
          held.push('enter');
          try {
            return await run();
          } finally {
            held.push('exit');
          }
        },
      };

      const client = new PersonalTokenClient({
        apiUrl: API_URL,
        store,
        lock,
        fetch: (async () =>
          new Response(
            JSON.stringify({
              data: {
                accessToken: 'atp_access',
                refreshToken: 'atr_rotated',
                expiresIn: 900,
                identity: IDENTITY,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )) as unknown as typeof fetch,
      });

      expect(await client.getAccessToken()).toBe('atp_access');
      expect(held).toEqual(['enter', 'exit']);

      // refresh와 access 캐시 파일만 추가되고 별도 잠금 파일은 만들지 않는다.
      const nextProcess = createPersonalTokenStore(
        API_URL,
        createCredentialStore({ homeDir: home, platform: 'darwin', runner: lockedKeychain }),
      );
      expect(nextProcess.read()).toBe('atr_rotated');
      expect(existsSync(join(home, '.agentteams', 'locks'))).toBe(false);
      expect(readdirSync(join(home, '.agentteams', 'credentials'))).toHaveLength(2);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('회전 응답 유실 재시도', () => {
  it('네트워크 실패 후 동일 토큰으로 잠금 안에서 한 번만 재시도한다', async () => {
    const store = fakeStore('atr_old');
    const order: string[] = [];
    let calls = 0;
    const fetchMock = jest.fn(async (_url: unknown, init: RequestInit) => {
      order.push('fetch');
      expect(JSON.parse(String(init.body)).refreshToken).toBe('atr_old');
      if (calls++ === 0) throw Object.assign(new Error('offline'), { cause: { code: 'ECONNREFUSED' } });
      return jsonResponse(200, tokenPayload());
    });
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      lock: recordingLock(order),
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await client.getAccessToken()).toBe('atp_access_1');
    expect(store.value).toBe('atr_refresh_1');
    expect(order).toEqual(['lock:acquire', 'fetch', 'fetch', 'lock:release']);
    expect(TOKEN_REQUEST_TIMEOUT_MS * 2).toBeLessThan(DEFAULT_STALE_AFTER_MS);
  });

  it('두 번 실패하면 NETWORK로 분류하고 자격증명을 유지한다', async () => {
    const store = fakeStore('atr_old');
    const fetchMock = jest.fn(async () => {
      throw Object.assign(new Error('offline'), { cause: { code: 'ECONNREFUSED' } });
    });
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock });
    expect(await client.getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.value).toBe('atr_old');
    expect(client.state().refreshFailure).toBe('NETWORK');
  });

  for (const name of ['AbortError', 'TimeoutError']) {
    it(`${name} 뒤에는 즉시 재제시하지 않고 자격증명을 보존한다`, async () => {
      const store = fakeStore('atr_old');
      const fetchMock = jest.fn(async () => {
        throw new DOMException('timed out', name);
      });
      const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock });
      expect(await client.getAccessToken()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(store.value).toBe('atr_old');
      expect(client.state().refreshFailure).toBe('NETWORK');
    });
  }

  it('요청은 서버의 12초 회전 예산을 기다리며 두 요청도 잠금 만료 전 끝난다', () => {
    expect(TOKEN_REQUEST_TIMEOUT_MS).toBeGreaterThan(12_000);
    expect(TOKEN_REQUEST_TIMEOUT_MS * 2).toBeLessThan(DEFAULT_STALE_AFTER_MS);
  });

  it('5xx는 SERVER로 분류하고 재시도하거나 삭제하지 않는다', async () => {
    const store = fakeStore('atr_old');
    const fetchMock = jest.fn(async () => jsonResponse(503, { error: 'unavailable' }));
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock });
    expect(await client.getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.value).toBe('atr_old');
    expect(client.state().refreshFailure).toBe('SERVER');
  });

  it.each(['reused', 'expired', 'invalid'] as const)('401 거절 사유 %s를 보존한다', async (reason) => {
    const store = fakeStore('atr_old');
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: async () => jsonResponse(401, { error: 'invalid_grant', reason }),
    });
    expect(await client.getAccessToken()).toBeNull();
    expect(store.value).toBeNull();
    expect(client.state()).toMatchObject({ reconnectRequired: true, revokedReason: reason });
  });
});

describe('프로세스 간 access 캐시', () => {
  const cached = { accessToken: 'atp_cached', expiresAt: 900_000, identity: IDENTITY };

  it('유효 캐시는 fetch 없이 사용하고 만료 임박 캐시는 회전한다', async () => {
    const store = fakeStore('atr_old');
    store.access = cached;
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    let now = 0;
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock, now: () => now });
    expect(await client.getAccessToken()).toBe('atp_cached');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.state().identity).toEqual(IDENTITY);
    now = 840_000;
    expect(await client.getAccessToken()).toBe('atp_access_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 무효화는 공유 캐시를 지우고 재회전한다', async () => {
    const store = fakeStore('atr_old');
    store.access = cached;
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock, now: () => 0 });
    await client.getAccessToken();
    client.invalidateAccessToken();
    expect(store.access).toBeNull();
    expect(await client.getAccessToken()).toBe('atp_access_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['revoke', 'forgetLocalCredential'] as const)('%s는 캐시도 삭제한다', async (method) => {
    const store = fakeStore('atr_old');
    store.access = cached;
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: async () => new Response(null, { status: 204 }),
      now: () => 0,
    });
    await client.getAccessToken();
    await client[method]();
    expect(store.access).toBeNull();
    expect(store.value).toBeNull();
  });

  it('잠금 대기 중 다른 프로세스가 저장한 캐시를 다시 읽는다', async () => {
    const store = fakeStore('atr_old');
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const lock: RefreshLock = {
      withLock: async (run) => {
        store.access = cached;
        return run();
      },
    };
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, lock, fetch: fetchMock, now: () => 0 });
    expect(await client.getAccessToken()).toBe('atp_cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('캐시 저장 실패가 성공한 회전을 실패로 바꾸지 않는다', async () => {
    const store = fakeStore('atr_old');
    store.saveAccess = () => {
      throw new Error('locked');
    };
    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store,
      fetch: async () => jsonResponse(200, tokenPayload()),
    });
    expect(await client.getAccessToken()).toBe('atp_access_1');
    expect(store.value).toBe('atr_refresh_1');
  });

  posixIt('캐시 지문·본문 검증과 API URL 격리를 적용한다', () => {
    const home = mkdtempSync(join(tmpdir(), 'agentteams-cache-validation-'));
    try {
      const backing = createCredentialStore({
        homeDir: home,
        platform: 'linux',
        runner: () => ({ status: 1, stdout: '', stderr: '' }),
      });
      const store = createPersonalTokenStore(API_URL, backing);
      store.saveAccess?.(cached, 'atr_old');
      expect(store.readAccess?.('atr_old')).toEqual(cached);
      expect(store.readAccess?.('atr_other_login')).toBeNull();
      expect(createPersonalTokenStore('https://other.test', backing).readAccess?.('atr_old')).toBeNull();
      backing.save(`personal-access:${API_URL}`, '{broken');
      expect(store.readAccess?.('atr_old')).toBeNull();
      store.removeAccess?.();
      expect(backing.read(`personal-access:${API_URL}`, { fresh: true })).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('삭제 실패로 남은 401 캐시는 같은 프로세스에서 다시 선택하지 않는다', async () => {
    const store = fakeStore('atr_old');
    store.access = cached;
    store.removeAccess = () => {
      throw new Error('locked');
    };
    const fetchMock = jest.fn(async () => jsonResponse(200, tokenPayload()));
    const client = new PersonalTokenClient({ apiUrl: API_URL, store, fetch: fetchMock, now: () => 0 });
    await client.getAccessToken();
    client.invalidateAccessToken();
    expect(await client.getAccessToken()).toBe('atp_access_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  posixIt('독립 Node 프로세스 두 개에서 두 번째 token endpoint 호출은 0회다', () => {
    const home = mkdtempSync(join(tmpdir(), 'agentteams-access-process-'));
    try {
      // 테스트 실행 전 빌드 산출물에 의존하지 않고 현재 소스를 독립 프로세스에서 실행한다.
      for (const name of [
        'personalTokenClient',
        'personalTokenStore',
        'credentialStore',
        'fileCredentialStore',
        'refreshLock',
        'slotHash',
      ]) {
        const source = readFileSync(new URL(`../src/auth/${name}.ts`, import.meta.url), 'utf8');
        const compiled = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
        });
        writeFileSync(join(home, `${name}.js`), compiled.outputText);
      }
      writeFileSync(join(home, 'package.json'), JSON.stringify({ type: 'module' }));
      const script = `
        import { PersonalTokenClient } from './personalTokenClient.js';
        import { createPersonalTokenStore } from './personalTokenStore.js';
        import { createCredentialStore } from './credentialStore.js';
        const backing = createCredentialStore({ homeDir: process.cwd(), platform: 'linux', runner: () => ({ status: 1, stdout: '', stderr: '' }) });
        const store = createPersonalTokenStore('https://cache.test', backing);
        if (!store.read()) store.save('atr_initial');
        let calls = 0;
        const client = new PersonalTokenClient({ apiUrl: 'https://cache.test', store, fetch: async () => {
          calls++;
          return new Response(JSON.stringify({ data: { accessToken: 'atp_test', refreshToken: 'atr_next', expiresIn: 900, identity: { memberId: 'm', email: 'm@test', nickname: 'm' } } }), { status: 200 });
        } });
        await client.getAccessToken();
        process.stdout.write(JSON.stringify({ calls, identity: client.state().identity }));
      `;
      const run = () =>
        JSON.parse(
          execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: home,
            encoding: 'utf8',
            timeout: 10_000,
          }),
        );
      expect(run().calls).toBe(1);
      expect(run()).toEqual({ calls: 0, identity: { memberId: 'm', email: 'm@test', nickname: 'm' } });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
