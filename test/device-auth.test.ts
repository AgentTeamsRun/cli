/**
 * `--device-auth` (RFC 8628) contract.
 *
 * The load-bearing assertion in this file is the *negative* one: with `SSH_*` set
 * and no flag, the loopback path must still run and nothing may call the device
 * endpoints. That test is what stops environment auto-detection from being
 * reintroduced — a change that would silently downgrade every local login.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_URL = 'https://api.test.agentteams.run';
const WEB_URL = 'https://web.test.agentteams.run';

// 인증 흐름 테스트가 CI 호스트의 실제 브라우저를 띄우면 Windows에서 자식 Edge가 임시
// 디렉터리를 점유하고 후속 테스트까지 오염시킨다. 여기서는 호출 계약만 검증한다.
const openBrowser = jest.fn(async () => undefined);
jest.unstable_mockModule('open', () => ({ __esModule: true, default: openBrowser }));

const startAuthorizationCodeServer = jest.fn(async () => ({
  port: 45678,
  state: 'loopback-state-0123456789',
  waitForCallback: async () => ({ code: 'atc_code', state: 'loopback-state-0123456789' }),
  server: { listening: false, close: () => {} },
}));

jest.unstable_mockModule('../src/utils/authServer.js', () => ({
  __esModule: true,
  startAuthorizationCodeServer,
  createAuthState: () => 'loopback-state-0123456789',
  createPkcePair: () => ({ verifier: 'v'.repeat(43), challenge: 'c'.repeat(43) }),
}));

const exchangeAuthorizationCode = jest.fn(async () => ({
  accessToken: 'atp_access',
  expiresAt: Date.now() + 60_000,
  identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
}));

const pollDeviceToken = jest.fn<(deviceCode: string) => Promise<Record<string, unknown>>>();

const clientState = {
  connected: true,
  persisted: true,
  storeBackend: 'macos-keychain',
  storeReason: 'OK',
  identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
  expiresAt: null,
  reconnectRequired: false,
  refreshFailure: null,
};

jest.unstable_mockModule('../src/auth/personalTokenClient.js', () => ({
  __esModule: true,
  CLI_OAUTH_CLIENT_ID: 'agentteams-cli',
  getPersonalTokenClient: () => ({
    exchangeAuthorizationCode,
    pollDeviceToken,
    state: () => clientState,
    hasCredential: () => true,
  }),
  PersonalTokenError: class PersonalTokenError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'PersonalTokenError';
    }
  },
}));

const storeStatus = { backend: 'macos-keychain' as const, persisted: true, reason: 'OK' as string };

jest.unstable_mockModule('../src/auth/credentialStore.js', () => ({
  __esModule: true,
  getCredentialStore: () => ({
    status: () => storeStatus,
    read: () => null,
    save: () => ({ persisted: true, reason: 'OK' }),
    remove: () => {},
  }),
}));

const startPayload = {
  data: {
    deviceCode: 'atd_super_secret_device_code',
    userCode: 'BCDF-GHJK',
    verificationUri: `${WEB_URL}/cli/device`,
    verificationUriComplete: `${WEB_URL}/cli/device?code=BCDF-GHJK`,
    expiresIn: 900,
    interval: 5,
  },
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tempDirs: string[] = [];
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;
let originalFetch: typeof fetch;
let logSpy: ReturnType<typeof jest.spyOn>;
const logged: string[] = [];

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-device-auth-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(
    join(root, '.agentteams', 'config.json'),
    JSON.stringify({ teamId: 't-1', projectId: 'p-1', apiUrl: API_URL }, null, 2),
    'utf-8',
  );
  process.chdir(root);
  return root;
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  originalFetch = globalThis.fetch;
  logged.length = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  process.env.AGENTTEAMS_API_URL = API_URL;
  process.env.AGENTTEAMS_WEB_URL = WEB_URL;
  delete process.env.AGENTTEAMS_DEVICE_AUTH;
  startAuthorizationCodeServer.mockClear();
  openBrowser.mockClear();
  exchangeAuthorizationCode.mockClear();
  pollDeviceToken.mockReset();
  storeStatus.reason = 'OK';
  jest.resetModules();
});

afterEach(() => {
  logSpy.mockRestore();
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  process.env = originalEnv;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function loadAuthCommand() {
  return import('../src/commands/auth.js');
}

describe('flow selection', () => {
  test('SSH 환경변수가 있어도 플래그가 없으면 loopback 경로가 그대로 실행된다', async () => {
    // 이 테스트가 자동 감지 재도입을 막는 가드다.
    process.env.SSH_CONNECTION = '127.0.0.1 0 127.0.0.1 0';
    process.env.SSH_TTY = '/dev/pts/0';
    createProject();

    const requestedUrls: string[] = [];
    globalThis.fetch = jest.fn(async (url: unknown) => {
      requestedUrls.push(String(url));
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;

    const { executeAuthCommand, shouldUseDeviceAuth } = await loadAuthCommand();
    expect(shouldUseDeviceAuth({})).toBe(false);

    await executeAuthCommand('login', {});

    expect(startAuthorizationCodeServer).toHaveBeenCalledTimes(1);
    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(requestedUrls.some((url) => url.includes('/device/'))).toBe(false);
  });

  test('SSH 판정 시 출력된 URL 아래에 --device-auth 안내가 붙는다', async () => {
    process.env.SSH_CONNECTION = '127.0.0.1 0 127.0.0.1 0';
    createProject();

    const { executeAuthCommand, DEVICE_AUTH_HINT } = await loadAuthCommand();
    await executeAuthCommand('login', {});

    expect(logged.join('\n')).toContain(DEVICE_AUTH_HINT);
  });

  test('loopback 60초 타임아웃 오류에도 같은 안내가 붙는다', async () => {
    createProject();
    startAuthorizationCodeServer.mockResolvedValueOnce({
      port: 45678,
      state: 'loopback-state-0123456789',
      waitForCallback: async () => {
        throw new Error('OAuth callback timed out after 60 seconds.');
      },
      server: { listening: false, close: () => {} },
    });

    const { executeAuthCommand, DEVICE_AUTH_HINT } = await loadAuthCommand();
    await expect(executeAuthCommand('login', {})).rejects.toThrow(DEVICE_AUTH_HINT);
    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  test('환경변수와 --set-default 전역 설정도 명시 선언으로 취급된다', async () => {
    const root = createProject();

    const { shouldUseDeviceAuth } = await loadAuthCommand();
    expect(shouldUseDeviceAuth({}, root)).toBe(false);
    expect(shouldUseDeviceAuth({ deviceAuth: true })).toBe(true);

    process.env.AGENTTEAMS_DEVICE_AUTH = '1';
    expect(shouldUseDeviceAuth({})).toBe(true);
    delete process.env.AGENTTEAMS_DEVICE_AUTH;

    const { setDeviceAuthDefault } = await import('../src/utils/config.js');
    const path = setDeviceAuthDefault(true, root);
    expect(JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>).toMatchObject({ deviceAuth: true });
    expect(shouldUseDeviceAuth({}, root)).toBe(true);

    // 해제는 전역 config에서 키를 지우는 것이고, 프로젝트 config는 이 값을 절대 갖지 않는다.
    setDeviceAuthDefault(false, root);
    expect(shouldUseDeviceAuth({}, root)).toBe(false);
  });
});

describe('device login', () => {
  test('로컬 콜백 서버를 열지 않고 코드/검증 URL만 출력한 뒤 토큰을 저장한다', async () => {
    createProject();
    globalThis.fetch = jest.fn(async (url: unknown) => {
      if (String(url).endsWith('/api/auth/desktop/device/start')) return jsonResponse(200, startPayload);
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as unknown as typeof fetch;

    pollDeviceToken.mockResolvedValueOnce({ kind: 'pending' }).mockResolvedValueOnce({
      kind: 'approved',
      session: { accessToken: 'atp_a', expiresAt: Date.now(), identity: clientState.identity },
      setup: null,
    });

    const { executeAuthCommand } = await loadAuthCommand();
    const result = (await executeAuthCommand('login', { deviceAuth: true })) as Record<string, unknown>;

    expect(startAuthorizationCodeServer).not.toHaveBeenCalled();
    expect(result.deviceAuth).toBe(true);
    expect(result.authUrl).toBe(`${WEB_URL}/cli/device`);

    const output = logged.join('\n');
    expect(output).toContain('BCDF-GHJK');
    expect(output).toContain(`${WEB_URL}/cli/device`);
    // device code와 토큰은 절대 출력하지 않는다.
    expect(output).not.toContain('atd_super_secret_device_code');
    expect(output).not.toContain('atp_');
  }, 30_000);

  test('자격증명 저장소가 없으면 start를 호출하기 전에 실패한다', async () => {
    createProject();
    storeStatus.reason = 'NO_BACKEND';

    const requestedUrls: string[] = [];
    globalThis.fetch = jest.fn(async (url: unknown) => {
      requestedUrls.push(String(url));
      return jsonResponse(200, startPayload);
    }) as unknown as typeof fetch;

    const { executeAuthCommand } = await loadAuthCommand();
    await expect(executeAuthCommand('login', { deviceAuth: true })).rejects.toThrow(/credential store/i);
    expect(requestedUrls).toHaveLength(0);
  });
});

describe('start failures', () => {
  test('404(구 API)와 503(서버 미설정)이 서로 다른 조치를 안내한다', async () => {
    const { startDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');

    const notFound = jest.fn(async () => jsonResponse(404, { message: 'Not Found' })) as unknown as typeof fetch;
    await expect(startDeviceAuthorization({ apiUrl: API_URL, flow: 'login', fetchImpl: notFound })).rejects.toThrow(
      /without --device-auth/,
    );

    const unavailable = jest.fn(async () =>
      jsonResponse(503, { error: 'device_flow_unavailable', reason: 'missing_app_url' }),
    ) as unknown as typeof fetch;
    await expect(startDeviceAuthorization({ apiUrl: API_URL, flow: 'login', fetchImpl: unavailable })).rejects.toThrow(
      /APP_URL/,
    );
  });

  test('flow=setup은 러너 바인딩에 필요한 메타를 start 요청에 싣는다', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = jest.fn(async (_url: unknown, init: unknown) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
      return jsonResponse(200, startPayload);
    }) as unknown as typeof fetch;

    const { startDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    await startDeviceAuthorization({
      apiUrl: API_URL,
      flow: 'setup',
      projectName: 'remote-project',
      osType: 'LINUX',
      machineId: 'machine-abc',
      authPathEnc: 'v1.encrypted',
      fetchImpl,
    });

    expect(bodies[0]).toMatchObject({
      clientId: 'agentteams-cli',
      flow: 'setup',
      projectName: 'remote-project',
      osType: 'LINUX',
      machineId: 'machine-abc',
      authPathEnc: 'v1.encrypted',
    });
  });
});

describe('polling', () => {
  const start = {
    deviceCode: 'atd_code',
    userCode: 'BCDF-GHJK',
    verificationUri: `${WEB_URL}/cli/device`,
    verificationUriComplete: `${WEB_URL}/cli/device?code=BCDF-GHJK`,
    expiresIn: 900,
    interval: 5,
  };

  test('서버 interval을 지키고 slow_down이면 간격을 늘린다', async () => {
    const slept: number[] = [];
    pollDeviceToken
      .mockResolvedValueOnce({ kind: 'pending' })
      .mockResolvedValueOnce({ kind: 'slowDown', intervalSeconds: 10 })
      .mockResolvedValueOnce({
        kind: 'approved',
        session: { accessToken: 'atp_a', expiresAt: 0, identity: clientState.identity },
        setup: null,
      });

    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    const result = await pollDeviceAuthorization({
      apiUrl: API_URL,
      start,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([5000, 5000, 10_000]);
    expect(result.identity.email).toBe('dev@example.com');
  });

  test('서버가 interval을 안 주면 5초씩 누적한다', async () => {
    const slept: number[] = [];
    pollDeviceToken.mockResolvedValueOnce({ kind: 'slowDown', intervalSeconds: null }).mockResolvedValueOnce({
      kind: 'approved',
      session: { accessToken: 'atp_a', expiresAt: 0, identity: clientState.identity },
      setup: null,
    });

    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    await pollDeviceAuthorization({ apiUrl: API_URL, start, sleep: async (ms) => void slept.push(ms) });

    expect(slept).toEqual([5000, 10_000]);
  });

  test('거부·만료·무효는 각각 즉시 종료되고 재시도하지 않는다', async () => {
    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    const sleep = async () => {};

    for (const [outcome, pattern] of [
      [{ kind: 'denied' }, /denied in the browser/],
      [{ kind: 'expired' }, /expired/],
      [{ kind: 'invalid' }, /no longer valid/],
    ] as const) {
      pollDeviceToken.mockReset();
      pollDeviceToken.mockResolvedValue(outcome as Record<string, unknown>);
      await expect(pollDeviceAuthorization({ apiUrl: API_URL, start, sleep })).rejects.toThrow(pattern);
      expect(pollDeviceToken).toHaveBeenCalledTimes(1);
    }
  });

  test('일시적 네트워크 오류는 access_denied로 승격되지 않고 백오프 후 계속한다', async () => {
    const slept: number[] = [];
    pollDeviceToken
      .mockResolvedValueOnce({ kind: 'transient', detail: 'ECONNRESET' })
      .mockResolvedValueOnce({ kind: 'transient', detail: 'ECONNRESET' })
      .mockResolvedValueOnce({
        kind: 'approved',
        session: { accessToken: 'atp_a', expiresAt: 0, identity: clientState.identity },
        setup: null,
      });

    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    await expect(
      pollDeviceAuthorization({ apiUrl: API_URL, start, sleep: async (ms) => void slept.push(ms) }),
    ).resolves.toMatchObject({ setup: null });
    expect(slept).toEqual([5000, 10_000, 15_000]);
  });

  test('expiresIn이 지나면 서버 응답을 기다리지 않고 로컬에서 멈춘다', async () => {
    let clock = 0;
    pollDeviceToken.mockResolvedValue({ kind: 'pending' });

    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    await expect(
      pollDeviceAuthorization({
        apiUrl: API_URL,
        start: { ...start, expiresIn: 10 },
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/expired/);
  });

  test('AbortSignal(Ctrl+C)은 즉시 폴링을 끝낸다', async () => {
    const controller = new AbortController();
    controller.abort();
    pollDeviceToken.mockResolvedValue({ kind: 'pending' });

    const { pollDeviceAuthorization } = await import('../src/auth/deviceAuthClient.js');
    await expect(
      pollDeviceAuthorization({ apiUrl: API_URL, start, signal: controller.signal, sleep: async () => {} }),
    ).rejects.toThrow(/cancelled/);
    expect(pollDeviceToken).not.toHaveBeenCalled();
  });
});
