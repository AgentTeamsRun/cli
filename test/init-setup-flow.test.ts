/**
 * `agentteams init`의 인증 경로 end-to-end 계약.
 *
 * 여기서 고정하는 것은 "브라우저를 몇 번 여는가 / 어떤 자격증명을 만드는가 / 컨벤션을 몇 번
 * 쓰는가"다. 이 세 가지는 코드를 읽어서는 회귀를 못 잡는 종류의 성질이라, 실제 로컬 콜백
 * 서버에 POST를 보내 전체 흐름을 돌린다.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_CONVENTION_REFERENCE, LEGACY_CONVENTION_REFERENCES } from '../src/utils/conventionLink.js';

const WEB_ORIGIN = 'https://web.test.agentteams.run';
const API_URL = 'https://api.test.agentteams.run';
const CONVENTION_TEMPLATE = '# AGENT_RULES\n\n통합 setup으로 받은 컨벤션\n';

const envKeys = [
  'AGENTTEAMS_WEB_URL',
  'AGENTTEAMS_API_URL',
  'AGENTTEAMS_API_KEY',
  'AGENTTEAMS_TEAM_ID',
  'AGENTTEAMS_PROJECT_ID',
  'SSH_CONNECTION',
] as const;
const envBackup: Record<string, string | undefined> = {};

const tempDirs: string[] = [];

type CallbackPayload = Record<string, unknown>;

/** 발급된 인가 코드를 실제로 교환했는지까지 보려면 클라이언트 자체를 관찰해야 한다. */
const exchangeAuthorizationCode = jest.fn(async () => ({
  accessToken: 'atp_access_token',
  expiresAt: Date.now() + 60_000,
  identity: { memberId: 'member-1', email: 'dev@example.com', nickname: 'dev' },
}));

const fakeClientState = {
  connected: true,
  persisted: true,
  storeBackend: 'keychain',
  storeReason: 'OK',
  identity: { memberId: 'member-1', email: 'dev@example.com', nickname: 'dev' },
  expiresAt: null,
  reconnectRequired: false,
  refreshFailure: null,
};

/** device 경로는 인가 코드 대신 폴링 응답으로 setup 결과를 받는다. */
const pollDeviceToken = jest.fn(async () => ({
  kind: 'approved' as const,
  session: {
    accessToken: 'atp_access_token',
    expiresAt: Date.now() + 60_000,
    identity: { memberId: 'member-1', email: 'dev@example.com', nickname: 'dev' },
  },
  setup: {
    teamId: 'team-1',
    projectId: 'project-1',
    agentConfigId: 'config-1',
    agentName: 'remote-agent',
    seedPlanId: 'plan-1',
  } as Record<string, unknown> | null,
}));

const fakePersonalTokenClient = {
  exchangeAuthorizationCode,
  pollDeviceToken,
  state: () => fakeClientState,
  hasCredential: jest.fn(() => true),
  getAccessToken: async () => 'atp_access_token',
  invalidateAccessToken: () => {},
};

/** 저장 계층이 어떤 backend로 지속하는지를 테스트별로 갈아끼우기 위해 가변으로 둔다. */
const mockStoreStatus: { backend: string; persisted: boolean; reason: string; detail?: string } = {
  backend: 'macos-keychain',
  persisted: true,
  reason: 'OK',
};

jest.unstable_mockModule('../src/auth/credentialStore.js', () => ({
  __esModule: true,
  getCredentialStore: () => ({
    status: () => mockStoreStatus,
    read: () => null,
    save: () => ({ persisted: true, reason: 'OK' }),
    remove: () => {},
  }),
}));

jest.unstable_mockModule('../src/auth/personalTokenClient.js', () => ({
  __esModule: true,
  // device 클라이언트가 start 요청에 실어 보내는 값이라, mock에도 있어야 모듈이 링크된다.
  CLI_OAUTH_CLIENT_ID: 'agentteams-cli',
  getPersonalTokenClient: () => fakePersonalTokenClient,
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

jest.unstable_mockModule('../src/utils/updateCheck.js', () => ({
  __esModule: true,
  compareVersions: (current: string, latest: string) => current !== latest,
  formatUpdateMessage: () => '',
  getLatestCliVersion: async () => '0.1.92',
  readCache: () => null,
  startUpdateCheck: async () => null,
  writeCache: () => {},
}));

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentteams-init-setup-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * 로컬 콜백 서버 하나당 authorize URL 한 줄이 출력된다. 출력된 URL 개수가 곧 사용자가 마주하는
 * 브라우저 화면 수라, "브라우저 1회"는 이 목록의 길이로 판정한다.
 */
function captureAuthorizeUrls(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    const line = args.map(String).join(' ');
    if (line.includes('/cli/authorize?')) {
      urls.push(line.trim());
    }
  });
  return { urls, restore: () => spy.mockRestore() };
}

async function waitForAuthorizeUrl(urls: string[]): Promise<URL> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (urls.length > 0) return new URL(urls[0] as string);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The authorize URL was never printed.');
}

async function postCallback(port: string, body: CallbackPayload): Promise<number> {
  const response = await fetch(`http://localhost:${port}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: JSON.stringify(body),
  });
  return response.status;
}

/**
 * `jest.resetModules()` 이후의 모듈 레지스트리를 쓴다.
 *
 * 테스트 파일 상단에서 정적으로 import한 axios는 init이 실제로 쓰는 인스턴스와 다른 사본이라,
 * 거기에 spy를 걸면 아무 요청도 가로채지 못한다. 같은 레지스트리에서 함께 가져와야 한다.
 */
async function loadInitModules() {
  const axios = (await import('axios')).default;
  const { executeInitCommand } = await import('../src/commands/init.js');
  return { axios, executeInitCommand };
}

type MockedAxios = Awaited<ReturnType<typeof loadInitModules>>['axios'];

/** conventionDownload가 실제로 도는 데 필요한 최소 응답 집합. */
function mockConventionEndpoints(axios: MockedAxios): { requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
    requestedUrls.push(url);
    if (url.endsWith('/api/platform/guides')) return { data: { data: [] } };
    if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
    if (url.endsWith('/convention')) return { data: { data: { content: CONVENTION_TEMPLATE } } };
    if (url.endsWith('/download-all')) return { data: { data: [] } };
    if (url.endsWith('/agent-configs')) return { data: { data: [{ id: 'first-listed-config' }] } };
    // freshness 검사(`convention status`)가 manifest와 대조하는 서버 목록.
    if (url.endsWith('/conventions')) return { data: { data: [], meta: { totalPages: 1 } } };
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  return { requestedUrls };
}

beforeEach(() => {
  for (const key of envKeys) envBackup[key] = process.env[key];
  process.env.AGENTTEAMS_WEB_URL = WEB_ORIGIN;
  process.env.AGENTTEAMS_API_URL = API_URL;
  delete process.env.AGENTTEAMS_API_KEY;
  delete process.env.AGENTTEAMS_TEAM_ID;
  delete process.env.AGENTTEAMS_PROJECT_ID;
  // 테스트 러너에서 실제 브라우저가 열리지 않도록, init이 이미 아는 headless 경로를 탄다.
  process.env.SSH_CONNECTION = '127.0.0.1 0 127.0.0.1 0';
  exchangeAuthorizationCode.mockClear();
  fakePersonalTokenClient.hasCredential.mockReturnValue(true);
  fakeClientState.connected = true;
  fakeClientState.reconnectRequired = false;
  fakeClientState.refreshFailure = null;
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of envKeys) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('init unified setup (new CLI x new web)', () => {
  test('opens one browser screen, creates no agent key, and syncs the convention once', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    const { requestedUrls } = mockConventionEndpoints(axios);
    const postSpy = jest.spyOn(axios, 'post');
    const deleteSpy = jest.spyOn(axios, 'delete');
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      // 통합 setup을 명시적으로 요청한다. 구 web은 이 두 파라미터를 무시한다.
      expect(authorizeUrl.searchParams.get('flow')).toBe('setup');
      expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();

      const status = await postCallback(authorizeUrl.searchParams.get('port') as string, {
        code: 'atc_authorization_code',
        state: authorizeUrl.searchParams.get('state'),
        teamId: 'team-1',
        projectId: 'project-1',
        configId: 'config-1',
        agentName: 'demo-agent',
        seedPlanId: null,
      });
      expect(status).toBe(200);

      const result = (await pending) as { agentName: string; authMode: string };
      expect(result.agentName).toBe('demo-agent');
      expect(result.authMode).toBe('personal-token');

      // 브라우저 왕복 1회 = 로컬 콜백 서버 1개.
      expect(urls).toHaveLength(1);

      // 이 경로가 만들어진 이유: setup용 agent key를 발급하지도, 폐기하지도 않는다.
      expect(postSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();

      // 컨벤션 템플릿 조회는 정확히 1회다. 조회 1회당 convention.md 쓰기 1회이므로,
      // 예전처럼 init과 conventionDownload가 같은 파일을 연달아 두 번 쓰지 않는다.
      const conventionRequests = requestedUrls.filter((url) => url.endsWith('/convention'));
      expect(conventionRequests).toHaveLength(1);
      // 목록에서 아무거나 고르지 않고, 이번 setup이 만든 config를 그대로 쓴다.
      expect(conventionRequests[0]).toBe(`${API_URL}/api/projects/project-1/agent-configs/config-1/convention`);
      expect(requestedUrls).not.toContain(`${API_URL}/api/projects/project-1/agent-configs`);

      expect(readFileSync(join(cwd, '.agentteams', 'convention.md'), 'utf-8')).toBe(CONVENTION_TEMPLATE);

      const config = JSON.parse(readFileSync(join(cwd, '.agentteams', 'config.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(config).toMatchObject({
        teamId: 'team-1',
        projectId: 'project-1',
        apiUrl: API_URL,
        authMode: 'personal-token',
      });
      expect(config).not.toHaveProperty('apiKey');
    } finally {
      restore();
    }
  }, 20000);
});

/**
 * 로컬 어댑터(진입점 파일 / .geminiignore / post-checkout hook)는 자격증명과 config가
 * 이미 디스크에 저장된 *뒤에* 돈다. 그래서 여기서 고정하는 성질은 두 가지다.
 *
 * 1. 무엇을 만드는가 — 비-TTY 기본 실행이 네 종류를 무조건 만들지 않는다.
 * 2. 실패가 어디까지 번지는가 — 어댑터 하나가 실패해도 연결은 성공으로 남는다.
 */
describe('init local adapters (new project path)', () => {
  type NewProjectResult = {
    success: true;
    agentFiles: { relativePath: string; type: string }[];
    postCheckoutHook?: { status: string };
    readiness: { stage: string; status: string; issues: { code: string; message: string }[] }[];
    localAdapters: { adapter: string; status: string; issues: { code: string; message: string }[] }[];
  };

  /** 실제 콜백 왕복까지 포함한 new-project 전체 실행. */
  async function runNewProjectInit(cwd: string, options: Record<string, unknown> = {}): Promise<NewProjectResult> {
    const { axios, executeInitCommand } = await loadInitModules();
    mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd, ...options });
      const authorizeUrl = await waitForAuthorizeUrl(urls);
      await postCallback(authorizeUrl.searchParams.get('port') as string, {
        code: 'atc_authorization_code',
        state: authorizeUrl.searchParams.get('state'),
        teamId: 'team-1',
        projectId: 'project-1',
        configId: 'config-1',
        agentName: 'demo-agent',
      });
      return (await pending) as NewProjectResult;
    } finally {
      restore();
    }
  }

  function createGitProject(): string {
    const cwd = createTempProject();
    execFileSync('git', ['init', '-b', 'main'], { cwd });
    return cwd;
  }

  function adapterOf(result: NewProjectResult, adapter: string) {
    return result.localAdapters.find((entry) => entry.adapter === adapter);
  }

  function localAdaptersStep(result: NewProjectResult) {
    return result.readiness.find((step) => step.stage === 'local-adapters');
  }

  // 갓 만든 저장소에는 `.claude/`가 아직 없다(프로젝트 스코프 승인 시점에 생긴다).
  // 마커만 보면 여기서 0개를 만들게 되는데, 그러면 에이전트가 컨벤션에 닿을 통로가
  // 아예 사라진다. 그래서 신호가 하나도 없을 때만 CLAUDE.md 1종으로 폴백한다.
  test('falls back to CLAUDE.md when nothing signals an AI client', async () => {
    const cwd = createTempProject();

    const result = await runNewProjectInit(cwd);

    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'created' }]);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(cwd, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(cwd, '.cursor'))).toBe(false);
    expect(adapterOf(result, 'agent-entry-points')).toMatchObject({ status: 'READY' });
    // 연결 자체는 여전히 성공이다.
    expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(true);
  }, 20000);

  test('creates only the entry points of the detected clients', async () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const result = await runNewProjectInit(cwd);

    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'created' }]);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  }, 20000);

  test('leaves an existing entry point alone instead of writing a -example sibling', async () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Existing instructions\n', 'utf-8');

    const result = await runNewProjectInit(cwd);

    expect(existsSync(join(cwd, 'CLAUDE-example.md'))).toBe(false);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe('# Existing instructions\n');
    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'skipped' }]);
    expect(adapterOf(result, 'agent-entry-points')).toMatchObject({ status: 'SKIPPED' });
  }, 20000);

  test('--agent-files-example restores the legacy example write', async () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Existing instructions\n', 'utf-8');

    const result = await runNewProjectInit(cwd, { agentFiles: 'CLAUDE.md', agentFilesExample: true });

    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE-example.md', type: 'example' }]);
    expect(existsSync(join(cwd, 'CLAUDE-example.md'))).toBe(true);
  }, 20000);

  test('refreshes an entry point an older CLI wrote instead of leaving it stale', async () => {
    // 이미 init한 저장소가 새 문구를 받는 유일한 경로다. 내용이 옛 상수와 정확히 일치하면
    // 사용자가 손대지 않은 우리 파일이므로 제자리에서 갱신한다.
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'CLAUDE.md'), LEGACY_CONVENTION_REFERENCES[0], 'utf-8');

    const result = await runNewProjectInit(cwd, { agentFiles: 'CLAUDE.md' });

    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'upgraded' }]);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe(DEFAULT_CONVENTION_REFERENCE);
    expect(adapterOf(result, 'agent-entry-points')).toMatchObject({ status: 'READY' });
  }, 20000);

  test('upgrades in place rather than writing a -example sibling for a stale entry point', async () => {
    const cwd = createTempProject();
    writeFileSync(join(cwd, 'CLAUDE.md'), LEGACY_CONVENTION_REFERENCES[0], 'utf-8');

    const result = await runNewProjectInit(cwd, { agentFiles: 'CLAUDE.md', agentFilesExample: true });

    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'upgraded' }]);
    expect(existsSync(join(cwd, 'CLAUDE-example.md'))).toBe(false);
  }, 20000);

  test('an explicit --agent-files list creates exactly those files and nothing else', async () => {
    const cwd = createTempProject();
    // 감지 신호가 있어도 명시 옵션이 이긴다.
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const result = await runNewProjectInit(cwd, { agentFiles: 'AGENTS.md' });

    expect(result.agentFiles).toEqual([{ relativePath: 'AGENTS.md', type: 'created' }]);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
  }, 20000);

  test('--agent-files none creates nothing at all', async () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const result = await runNewProjectInit(cwd, { agentFiles: 'none' });

    expect(result.agentFiles).toEqual([]);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
  }, 20000);

  test('rejects an unknown --agent-files value before opening a browser', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      await expect(executeInitCommand({ cwd, agentFiles: 'CLAUDE.txt' })).rejects.toThrow(
        /Unknown --agent-files value/,
      );
      expect(urls).toHaveLength(0);
      expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(false);
    } finally {
      restore();
    }
  }, 20000);

  test('does not touch .geminiignore unless GEMINI.md was selected', async () => {
    const cwd = createTempProject();
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const withoutGemini = await runNewProjectInit(cwd);
    expect(existsSync(join(cwd, '.geminiignore'))).toBe(false);
    expect(adapterOf(withoutGemini, 'gemini-ignore')).toMatchObject({ status: 'SKIPPED' });

    const geminiCwd = createTempProject();
    const withGemini = await runNewProjectInit(geminiCwd, { agentFiles: 'GEMINI.md' });
    expect(readFileSync(join(geminiCwd, '.geminiignore'), 'utf-8')).toContain('!.agentteams');
    expect(adapterOf(withGemini, 'gemini-ignore')).toMatchObject({ status: 'READY' });
  }, 30000);

  test('.gitignore stays unconditional — it is what keeps secrets out of the repository', async () => {
    const cwd = createTempProject();

    const result = await runNewProjectInit(cwd);

    expect(readFileSync(join(cwd, '.gitignore'), 'utf-8')).toContain('.agentteams');
    expect(adapterOf(result, 'gitignore')).toMatchObject({ status: 'READY' });
  }, 20000);

  test('installs no post-checkout hook in a repository without linked worktrees', async () => {
    const cwd = createGitProject();

    const result = await runNewProjectInit(cwd);

    expect(existsSync(join(cwd, '.git', 'hooks', 'post-checkout'))).toBe(false);
    expect(result.postCheckoutHook).toBeUndefined();
    expect(adapterOf(result, 'post-checkout-hook')).toMatchObject({ status: 'SKIPPED' });
    // 건너뛴 이유와 되돌리는 명령이 결과에 남아야 사용자가 복구할 수 있다.
    const message = adapterOf(result, 'post-checkout-hook')?.issues[0]?.message ?? '';
    expect(message).toContain('agentteams doctor');
    expect(localAdaptersStep(result)?.issues.some((issue) => issue.message.includes('agentteams doctor'))).toBe(true);
  }, 20000);

  test('installs the hook when the opt-in flag is given', async () => {
    const cwd = createGitProject();

    const result = await runNewProjectInit(cwd, { installWorktreeHook: true });

    expect(existsSync(join(cwd, '.git', 'hooks', 'post-checkout'))).toBe(true);
    expect(result.postCheckoutHook).toMatchObject({ status: 'ready' });
    expect(adapterOf(result, 'post-checkout-hook')).toMatchObject({ status: 'READY' });
  }, 20000);

  test('installs the hook when the repository already uses linked worktrees', async () => {
    const cwd = createGitProject();
    writeFileSync(join(cwd, 'README.md'), '# repo\n', 'utf-8');
    execFileSync('git', ['add', 'README.md'], { cwd });
    execFileSync(
      'git',
      ['-c', 'user.name=AgentTeams Test', '-c', 'user.email=test@agentteams.run', 'commit', '-m', 'initial'],
      { cwd },
    );
    const worktreeDir = join(cwd, '..', `${basename(cwd)}-wt`);
    execFileSync('git', ['worktree', 'add', '-b', 'wt-test', worktreeDir], { cwd });

    try {
      const result = await runNewProjectInit(cwd);

      expect(existsSync(join(cwd, '.git', 'hooks', 'post-checkout'))).toBe(true);
      expect(adapterOf(result, 'post-checkout-hook')).toMatchObject({ status: 'READY' });
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  }, 20000);

  test('never overwrites a user post-checkout hook, and reports the existing issue verbatim', async () => {
    const cwd = createGitProject();
    const hookPath = join(cwd, '.git', 'hooks', 'post-checkout');
    mkdirSync(join(cwd, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho mine\n', 'utf-8');

    const result = await runNewProjectInit(cwd, { installWorktreeHook: true });

    expect(readFileSync(hookPath, 'utf-8')).toBe('#!/bin/sh\necho mine\n');
    expect(adapterOf(result, 'post-checkout-hook')).toMatchObject({
      status: 'DEGRADED',
      retryCommand: 'agentteams doctor',
    });
    expect(adapterOf(result, 'post-checkout-hook')?.issues[0]?.code).toBe('hook-custom');
    expect(localAdaptersStep(result)).toMatchObject({ status: 'DEGRADED', retryCommand: 'agentteams doctor' });
  }, 20000);

  // 어댑터 실패가 init 전체 실패로 번지던 자리. 이 시점에는 자격증명과 config가 이미
  // 저장돼 있어서, 예외가 새면 "초기화 실패"라고 말하면서 실제로는 연결이 끝난 모순 상태가 된다.
  test('an entry point write failure degrades that adapter without failing the connection', async () => {
    const cwd = createTempProject();
    // `.cursor/rules`를 디렉터리가 아닌 파일로 만들어 두면 mdc 쓰기가 ENOTDIR로 실패한다.
    mkdirSync(join(cwd, '.cursor'), { recursive: true });
    writeFileSync(join(cwd, '.cursor', 'rules'), 'not a directory\n', 'utf-8');

    const result = await runNewProjectInit(cwd, { agentFiles: '.cursor/rules/agentteams.mdc' });

    expect(result.success).toBe(true);
    expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(true);
    expect(readFileSync(join(cwd, '.agentteams', 'convention.md'), 'utf-8')).toBe(CONVENTION_TEMPLATE);
    expect(adapterOf(result, 'agent-entry-points')).toMatchObject({
      status: 'DEGRADED',
      retryCommand: 'agentteams init --agent-files <list>',
    });
    // 조용히 삼키지 않는다.
    expect(adapterOf(result, 'agent-entry-points')?.issues).not.toHaveLength(0);
    expect(localAdaptersStep(result)?.status).toBe('DEGRADED');
    // 뒤따르는 어댑터는 계속 실행된다.
    expect(adapterOf(result, 'post-checkout-hook')).toBeDefined();
  }, 20000);

  // 여러 파일 중 일부만 실패하는 경로. 루프가 통째로 예외를 던지면 그때까지 디스크에
  // 실제로 쓴 파일 기록이 함께 날아가, JSON 계약(`agentFiles`)과 human 출력이 파일
  // 시스템 상태와 정반대가 된다.
  test('a partial entry point failure still reports the files that reached disk', async () => {
    const cwd = createTempProject();
    // `.cursor/rules`를 파일로 점유해 mdc 쓰기만 ENOTDIR로 실패시킨다.
    mkdirSync(join(cwd, '.cursor'), { recursive: true });
    writeFileSync(join(cwd, '.cursor', 'rules'), 'not a directory\n', 'utf-8');

    const result = await runNewProjectInit(cwd, { agentFiles: 'CLAUDE.md,.cursor/rules/agentteams.mdc' });

    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'created' }]);
    expect(adapterOf(result, 'agent-entry-points')).toMatchObject({ status: 'DEGRADED' });
    expect(adapterOf(result, 'agent-entry-points')?.issues[0]?.code).toBe('agent-entry-point-write-failed');
    expect(adapterOf(result, 'agent-entry-points')?.issues[0]?.message).toContain('.cursor/rules/agentteams.mdc');
  }, 20000);

  test('keeps every documented JSON field on the default new-project path', async () => {
    const cwd = createTempProject();

    const result = await runNewProjectInit(cwd);

    for (const key of [
      'success',
      'authUrl',
      'configPath',
      'conventionPath',
      'teamId',
      'projectId',
      'agentName',
      'agentFiles',
      'seedPlanId',
      'seedPlanWebUrl',
      'authMode',
      'readiness',
    ]) {
      expect(result).toHaveProperty(key);
    }
    expect(result.readiness.map(({ stage }) => stage)).toEqual([
      'project-binding',
      'credential',
      'convention-sync',
      'local-adapters',
    ]);
    expect(result.localAdapters.map(({ adapter }) => adapter)).toEqual([
      'gitignore',
      'agent-entry-points',
      'gemini-ignore',
      'post-checkout-hook',
    ]);
  }, 20000);
});

describe('init configured-project fast path', () => {
  /**
   * `synced: true`는 이미 `convention download`를 한 번 돌린 프로젝트다.
   * manifest가 없으면 freshness 검사가 "변경 없음"으로 즉시 반환하므로, 두 상태를
   * 구분하지 않으면 컨벤션이 하나도 없는 프로젝트를 READY로 보고하게 된다.
   */
  function createConfiguredProject({ synced = true }: { synced?: boolean } = {}): string {
    const cwd = createTempProject();
    mkdirSync(join(cwd, '.agentteams'), { recursive: true });
    writeFileSync(
      join(cwd, '.agentteams', 'config.json'),
      JSON.stringify({
        teamId: 'team-1',
        projectId: 'project-1',
        apiUrl: API_URL,
        authMode: 'personal-token',
      }),
      'utf-8',
    );
    writeFileSync(join(cwd, '.agentteams', 'convention.md'), '# Existing convention\n', 'utf-8');
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Existing instructions\n', 'utf-8');
    if (synced) {
      writeFileSync(
        join(cwd, '.agentteams', 'conventions.manifest.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-06T00:00:00.000Z',
          platformGuidesHash: 'aggregate-hash',
          entries: [],
        }),
        'utf-8',
      );
    }
    return cwd;
  }

  test('reuses the binding without browser, key creation, config rewrite, or example files', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    const configPath = join(cwd, '.agentteams', 'config.json');
    const configBefore = readFileSync(configPath, 'utf-8');
    const postSpy = jest.spyOn(axios, 'post');
    const { requestedUrls } = mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const result = await executeInitCommand({ cwd });

      expect(result).toMatchObject({
        success: true,
        mode: 'configured-project',
        teamId: 'team-1',
        projectId: 'project-1',
        conventionsUpdated: false,
      });
      if (!('mode' in result) || result.mode !== 'configured-project') {
        throw new Error('Expected the configured-project fast path.');
      }
      expect(result.readiness.map(({ stage }) => stage)).toEqual([
        'project-binding',
        'credential',
        'convention-sync',
        'local-adapters',
      ]);
      expect(result.readiness.find(({ stage }) => stage === 'convention-sync')?.status).toBe('READY');
      for (const step of result.readiness.filter(({ status }) => status === 'DEGRADED')) {
        expect(step.retryCommand).toEqual(expect.any(String));
        expect(step.retryCommand?.length).toBeGreaterThan(0);
      }
      expect(urls).toHaveLength(0);
      expect(postSpy).not.toHaveBeenCalled();
      // 이미 동기화된 프로젝트는 freshness 조회만 하고 다운로드는 건드리지 않는다.
      expect(requestedUrls.some((url) => url.endsWith('/download-all'))).toBe(false);
      expect(requestedUrls.some((url) => url.endsWith('/api/platform/guides'))).toBe(false);
      expect(readFileSync(configPath, 'utf-8')).toBe(configBefore);
      expect(existsSync(join(cwd, 'CLAUDE-example.md'))).toBe(false);
    } finally {
      restore();
    }
  });

  test('downloads conventions when the project has never synced, instead of reporting READY', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject({ synced: false });
    const { requestedUrls } = mockConventionEndpoints(axios);
    const { restore } = captureAuthorizeUrls();

    try {
      const result = await executeInitCommand({ cwd });
      if (!('mode' in result) || result.mode !== 'configured-project') {
        throw new Error('Expected the configured-project fast path.');
      }

      expect(result.conventionError).toBeUndefined();
      expect(result.conventionsUpdated).toBe(true);
      expect(result.readiness.find(({ stage }) => stage === 'convention-sync')?.status).toBe('READY');
      expect(requestedUrls.some((url) => url.endsWith('/download-all'))).toBe(true);
      expect(existsSync(join(cwd, '.agentteams', 'conventions.manifest.json'))).toBe(true);
    } finally {
      restore();
    }
  });

  test('fails with an auth login retry when an opted-in personal credential is missing', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    const ambientCwd = createTempProject();
    mkdirSync(join(ambientCwd, '.agentteams'), { recursive: true });
    writeFileSync(
      join(ambientCwd, '.agentteams', 'config.json'),
      JSON.stringify({
        teamId: 'unrelated-team',
        projectId: 'unrelated-project',
        apiUrl: API_URL,
        apiKey: 'key_unrelated_legacy_credential',
      }),
      'utf-8',
    );
    const originalCwd = process.cwd();
    const postSpy = jest.spyOn(axios, 'post');
    const { urls, restore } = captureAuthorizeUrls();
    fakePersonalTokenClient.hasCredential.mockReturnValue(false);
    fakeClientState.connected = false;

    try {
      process.chdir(ambientCwd);
      await expect(executeInitCommand({ cwd })).rejects.toThrow(/agentteams auth login/);
      expect(urls).toHaveLength(0);
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      restore();
    }
  });

  test('keeps the binding ready and reports only convention sync as degraded when freshness fails', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('network unavailable'));

    const result = await executeInitCommand({ cwd });
    if (!('mode' in result) || result.mode !== 'configured-project') {
      throw new Error('Expected the configured-project fast path.');
    }

    expect(result.conventionError).toContain('network unavailable');
    expect(result.readiness.find(({ stage }) => stage === 'project-binding')?.status).toBe('READY');
    expect(result.readiness.find(({ stage }) => stage === 'credential')?.status).toBe('READY');
    expect(result.readiness.find(({ stage }) => stage === 'convention-sync')).toMatchObject({
      status: 'DEGRADED',
      retryCommand: 'agentteams convention download',
    });
  });

  // 어댑터가 안내하는 retryCommand는 전부 `agentteams init`이다. 그런데 그 시점에는
  // config가 이미 저장돼 있어 재실행이 이 fast path로 들어온다. 여기서 어댑터를 돌리지
  // 않으면 "DEGRADED로 보고하고 복구 명령을 안내한다"는 전제가 통째로 무너진다 —
  // `--auth api-key` 경로에서 .gitignore가 실패하면 30일짜리 agent key가 담긴 config를
  // 커밋할 위험이 그대로 남는다.
  test('re-running init repairs .gitignore instead of only verifying the binding', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    mockConventionEndpoints(axios);
    rmSync(join(cwd, '.gitignore'), { force: true });

    const result = await executeInitCommand({ cwd });
    if (!('mode' in result) || result.mode !== 'configured-project') {
      throw new Error('Expected the configured-project fast path.');
    }

    expect(readFileSync(join(cwd, '.gitignore'), 'utf-8')).toContain('.agentteams');
    expect(result.localAdapters.find((adapter) => adapter.adapter === 'gitignore')?.status).toBe('READY');
  });

  test('re-running init with --agent-files creates the missing entry point', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    mockConventionEndpoints(axios);

    const result = await executeInitCommand({ cwd, agentFiles: 'AGENTS.md' });
    if (!('mode' in result) || result.mode !== 'configured-project') {
      throw new Error('Expected the configured-project fast path.');
    }

    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true);
    expect(result.agentFiles).toEqual([{ relativePath: 'AGENTS.md', type: 'created' }]);
    // 기존 파일은 여전히 건드리지 않는다.
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe('# Existing instructions\n');
  });

  // fast path는 재실행을 전제로 만든 기능이라 절대 프롬프트로 멈춰서는 안 된다.
  test('never prompts on the fast path even with a TTY attached', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    mockConventionEndpoints(axios);
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    try {
      const result = await executeInitCommand({ cwd });
      if (!('mode' in result) || result.mode !== 'configured-project') {
        throw new Error('Expected the configured-project fast path.');
      }
      expect(result.agentFiles).toEqual([{ relativePath: 'CLAUDE.md', type: 'skipped' }]);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  // 훅 게이트의 SSOT는 한 곳이다. doctor가 무조건 설치하면 두 번째 init 한 번으로
  // "워크트리를 쓰지 않는 저장소의 공유 .git/hooks를 건드리지 않는다"는 결정이 뒤집힌다.
  test('the fast path does not install the worktree hook a new-project run refused to install', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    execFileSync('git', ['init', '-b', 'main'], { cwd });
    mockConventionEndpoints(axios);

    const result = await executeInitCommand({ cwd });
    if (!('mode' in result) || result.mode !== 'configured-project') {
      throw new Error('Expected the configured-project fast path.');
    }

    expect(existsSync(join(cwd, '.git', 'hooks', 'post-checkout'))).toBe(false);
    expect(result.doctor.rootHook).toBe('skipped');
    expect(result.localAdapters.find((adapter) => adapter.adapter === 'post-checkout-hook')?.status).toBe('SKIPPED');
  });

  test('--install-worktree-hook installs it from the fast path too', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createConfiguredProject();
    execFileSync('git', ['init', '-b', 'main'], { cwd });
    mockConventionEndpoints(axios);

    const result = await executeInitCommand({ cwd, installWorktreeHook: true });
    if (!('mode' in result) || result.mode !== 'configured-project') {
      throw new Error('Expected the configured-project fast path.');
    }

    expect(existsSync(join(cwd, '.git', 'hooks', 'post-checkout'))).toBe(true);
    expect(result.localAdapters.find((adapter) => adapter.adapter === 'post-checkout-hook')?.status).toBe('READY');
  });

  /**
   * `--mcp`는 init이 클라이언트 설정을 건드려도 되는 유일한 통로다. 여기서 고정하는 것은
   * 세 가지다: 플래그가 없으면 아무 파일도 쓰지 않는다, 있으면 `mcp install`과 같은
   * 일괄 경로를 쓴다, 그리고 클라이언트 한 곳이 실패해도 init 자체는 성공으로 남는다.
   *
   * 감지 컨텍스트(HOME/PATH)와 vendor 실행은 전부 주입한다. 실제 개발 머신의 MCP 설정을
   * 건드리는 순간 이 테스트는 회귀 감시가 아니라 사고가 된다.
   */
  describe('--mcp opt-in', () => {
    type McpCapableResult = {
      success: true;
      mcp?: {
        scope: string;
        summary: { applied: number; skipped: number; failed: number };
        clients: { clientId: string; outcome: string; detail: string; manualSnippet?: string }[];
      };
    };

    function createClientFixture(executables: string[]): {
      homeDir: string;
      binDir: string;
      dependencies: Record<string, unknown>;
      calls: { executable: string; args: string[] }[];
    } {
      const homeDir = createTempProject();
      const binDir = createTempProject();
      for (const executable of executables) {
        writeFileSync(join(binDir, executable), '#!/bin/sh\n', { mode: 0o755 });
      }
      const calls: { executable: string; args: string[] }[] = [];
      return {
        homeDir,
        binDir,
        calls,
        dependencies: {
          context: { homeDir, env: { PATH: binDir } },
          credentials: { projectId: 'project-1', teamId: 'team-1', apiUrl: API_URL },
          vendorRunner: (executable: string, args: string[]) => {
            calls.push({ executable, args });
            return executable.endsWith('claude')
              ? { status: 9, stdout: '', stderr: 'claude blew up' }
              : { status: 0, stdout: 'added', stderr: '' };
          },
        },
      };
    }

    test('writes no client configuration and points at the command when the flag is absent', async () => {
      const { axios, executeInitCommand } = await loadInitModules();
      const cwd = createConfiguredProject();
      const fixture = createClientFixture(['cursor-agent']);
      mockConventionEndpoints(axios);

      const result = (await executeInitCommand({ cwd, mcpDependencies: fixture.dependencies })) as McpCapableResult;

      expect(result.mcp).toBeUndefined();
      expect(fixture.calls).toHaveLength(0);
      expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(false);
      expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
      expect(existsSync(join(fixture.homeDir, '.cursor'))).toBe(false);
    });

    test('registers the detected clients at project scope through the shared batch path', async () => {
      const { axios, executeInitCommand } = await loadInitModules();
      const cwd = createConfiguredProject();
      const fixture = createClientFixture(['cursor-agent']);
      mockConventionEndpoints(axios);

      const result = (await executeInitCommand({
        cwd,
        mcp: true,
        mcpDependencies: fixture.dependencies,
      })) as McpCapableResult;

      expect(result.success).toBe(true);
      expect(result.mcp?.scope).toBe('project');
      expect(result.mcp?.summary.applied).toBe(1);
      expect(result.mcp?.clients.find((client) => client.clientId === 'cursor-cli')?.outcome).toBe('INSTALLED');
      // 프로젝트 스코프는 저장소 안에만 쓴다. 머신 전역 설정은 init이 고를 수 없다.
      expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(true);
      expect(existsSync(join(fixture.homeDir, '.cursor'))).toBe(false);
    });

    test('keeps init successful when one client registration fails', async () => {
      const { axios, executeInitCommand } = await loadInitModules();
      const cwd = createConfiguredProject();
      const fixture = createClientFixture(['cursor-agent', 'claude']);
      mockConventionEndpoints(axios);

      const result = (await executeInitCommand({
        cwd,
        mcp: true,
        mcpDependencies: fixture.dependencies,
      })) as McpCapableResult;

      expect(result.success).toBe(true);
      expect(result.mcp?.summary.failed).toBe(1);
      const failed = result.mcp?.clients.find((client) => client.clientId === 'claude-code');
      expect(failed?.outcome).toBe('FAILED');
      expect(failed?.detail).toContain('exited with code 9');
      // 실패한 클라이언트 뒤에 있는 클라이언트도 계속 등록된다.
      expect(result.mcp?.clients.find((client) => client.clientId === 'cursor-cli')?.outcome).toBe('INSTALLED');
    });
  });
});

describe('init unified setup failure paths', () => {
  test('fails explicitly when an older web answers without the connection metadata', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      await postCallback(authorizeUrl.searchParams.get('port') as string, {
        code: 'atc_authorization_code',
        state: authorizeUrl.searchParams.get('state'),
      });

      // 원인(웹 배포가 아직 반영되지 않았다)과 탈출구(재시도 / CLI 버전 맞추기)가 모두 있어야
      // 한다. "다시 시도하세요"만으로는 배포가 따라올 때까지 사용자가 무한히 반복하게 된다.
      await expect(pending).rejects.toThrow(/older than this CLI/);
      await expect(pending).rejects.toThrow(/web deploy has not caught up/);
      await expect(pending).rejects.toThrow(/agentteams init/);
      await expect(pending).rejects.toThrow(/install a CLI version matching the deployed web/);

      // 인가 코드는 일부러 교환하지 않고, 반쯤 설정된 프로젝트도 남기지 않는다.
      expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(false);
    } finally {
      restore();
    }
  }, 20000);

  test('fails immediately — not after the 60s timeout — when a web that predates the authorization code answers', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      // 이 web은 flow=setup도 code_challenge도 모른다. 레거시 폼으로 떨어져 이미 발급한
      // agent key를 담아 보낸다 — 즉 `code`가 없다.
      const status = await postCallback(authorizeUrl.searchParams.get('port') as string, {
        teamId: 'team-1',
        projectId: 'project-1',
        agentName: 'demo-agent',
        apiKey: 'key_orphaned_value',
        configId: 'config-1',
        state: authorizeUrl.searchParams.get('state'),
      });
      // 콜백을 400으로 거절만 하면 CLI는 타임아웃(60초)까지 아무것도 모른 채 기다린다.
      expect(status).toBe(200);

      await expect(pending).rejects.toThrow(/older than this CLI/);
      await expect(pending).rejects.toThrow(/web deploy has not caught up/);
      // 그 화면이 이미 발급해 버린 30일짜리 키는 사용자만 폐기할 수 있다. 안내가 없으면
      // 사용자는 자기가 만든 줄도 모르는 장기 자격증명을 프로젝트에 남기게 된다.
      await expect(pending).rejects.toThrow(/revoke it in the web app/);
      // 타임아웃 문구가 섞여 나오면 원인 안내가 아니라 잡음이 된다.
      await expect(pending).rejects.not.toThrow(/timed out/);

      expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(false);
    } finally {
      restore();
    }
  }, 20000);

  test('fails instead of reporting success when the convention template cannot be written', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    // 서버가 content 없는 본문을 돌려주는 상황. 예전 init은 여기서 실패했고, 그 보장이
    // conventionDownload로 넘어가면서 사라지면 "저장했다"고 말하면서 파일은 없는 상태가 된다.
    jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
      if (url.endsWith('/api/platform/guides')) return { data: { data: [] } };
      if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
      if (url.endsWith('/convention')) return { data: { data: {} } };
      if (url.endsWith('/download-all')) return { data: { data: [] } };
      throw new Error(`unexpected GET ${url}`);
    }) as never);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      await postCallback(authorizeUrl.searchParams.get('port') as string, {
        code: 'atc_authorization_code',
        state: authorizeUrl.searchParams.get('state'),
        teamId: 'team-1',
        projectId: 'project-1',
        configId: 'config-1',
        agentName: 'demo-agent',
      });

      await expect(pending).rejects.toThrow(/Invalid convention template response from server/);
      expect(existsSync(join(cwd, '.agentteams', 'convention.md'))).toBe(false);
    } finally {
      restore();
    }
  }, 20000);

  test('writes no config when the credential cannot be stored', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    exchangeAuthorizationCode.mockRejectedValueOnce(
      new Error('Signed in, but the login could not be saved: the OS credential store rejected the write.'),
    );
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      await postCallback(authorizeUrl.searchParams.get('port') as string, {
        code: 'atc_authorization_code',
        state: authorizeUrl.searchParams.get('state'),
        teamId: 'team-1',
        projectId: 'project-1',
        configId: 'config-1',
        agentName: 'demo-agent',
      });

      await expect(pending).rejects.toThrow(/could not be saved/);
      // 자격증명 없이 config만 남으면 이후 모든 명령이 실패한다. 그 상태를 만들지 않는다.
      expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(false);
    } finally {
      restore();
    }
  }, 20000);
});

describe('init --auth api-key (compatibility path)', () => {
  test('keeps the legacy authorize URL, the legacy callback and the on-disk agent key', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    const { requestedUrls } = mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    try {
      const pending = executeInitCommand({ cwd, authMode: 'api-key' });
      const authorizeUrl = await waitForAuthorizeUrl(urls);

      // 통합 화면을 요청하지 않으므로 구/신 web 모두 레거시 폼을 보여준다.
      expect(authorizeUrl.searchParams.has('flow')).toBe(false);
      expect(authorizeUrl.searchParams.has('code_challenge')).toBe(false);

      await postCallback(authorizeUrl.searchParams.get('port') as string, {
        teamId: 'team-1',
        projectId: 'project-1',
        agentName: 'legacy-agent',
        apiKey: 'key_legacy_value',
        configId: 'config-1',
        state: authorizeUrl.searchParams.get('state'),
      });

      const result = (await pending) as { authMode: string; agentName: string };
      expect(result.authMode).toBe('api-key');
      expect(result.agentName).toBe('legacy-agent');

      const config = JSON.parse(readFileSync(join(cwd, '.agentteams', 'config.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(config.apiKey).toBe('key_legacy_value');
      expect(config).not.toHaveProperty('authMode');

      expect(readFileSync(join(cwd, '.agentteams', 'convention.md'), 'utf-8')).toBe(CONVENTION_TEMPLATE);
      // 이 경로는 개인 토큰을 만들지 않는다.
      expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
      // 그리고 여전히 목록 폴백으로 템플릿을 고른다(호출부가 configId를 전달하지 않는 경로).
      expect(requestedUrls).toContain(`${API_URL}/api/projects/project-1/agent-configs`);
    } finally {
      restore();
    }
  }, 20000);
});

describe('init --device-auth', () => {
  const DEVICE_START_PAYLOAD = {
    data: {
      deviceCode: 'atd_secret_device_code',
      userCode: 'BCDF-GHJK',
      verificationUri: `${WEB_ORIGIN}/cli/device`,
      verificationUriComplete: `${WEB_ORIGIN}/cli/device?code=BCDF-GHJK`,
      expiresIn: 900,
      // 테스트가 실제 interval만큼 기다리지 않도록 서버가 짧은 값을 지시한 상황을 쓴다.
      interval: 1,
    },
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    pollDeviceToken.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockStoreStatus.backend = 'macos-keychain';
    mockStoreStatus.persisted = true;
    mockStoreStatus.reason = 'OK';
    delete mockStoreStatus.detail;
    fakeClientState.storeBackend = 'keychain';
    fakeClientState.persisted = true;
  });

  test('OS 저장소를 못 써도 파일 fallback으로 설정이 끝까지 완료된다', async () => {
    // Linux·macOS·Windows SSH가 공통으로 부딪히던 지점: 여기서 멈추면 사용자는
    // 다른 기기에서 승인까지 마친 뒤 취소를 통보받았다.
    mockStoreStatus.backend = 'protected-file';
    mockStoreStatus.reason = 'OK';
    mockStoreStatus.detail = 'secret-tool could not be started on this machine';
    fakeClientState.storeBackend = 'protected-file';

    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const { urls, restore } = captureAuthorizeUrls();

    globalThis.fetch = jest.fn(async (url: unknown) => {
      if (String(url).endsWith('/api/auth/desktop/device/start')) {
        return new Response(JSON.stringify(DEVICE_START_PAYLOAD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as unknown as typeof fetch;

    try {
      const result = (await executeInitCommand({ cwd, deviceAuth: true })) as Record<string, unknown>;

      expect(result).toMatchObject({ success: true, authMode: 'personal-token' });
      // 실제 저장 위치를 결과에 그대로 싣는다 — 사람용 출력이 "OS 저장소"라고
      // 단정하지 않을 수 있는 유일한 근거다.
      expect(result.personalLogin).toMatchObject({ persisted: true, storeBackend: 'protected-file' });
      expect(urls).toHaveLength(0);

      const config = JSON.parse(readFileSync(join(cwd, '.agentteams', 'config.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(config).toMatchObject({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' });
      // 개인 로그인 경로는 API 키를 발급하지 않는다.
      expect(config.apiKey).toBeUndefined();
    } finally {
      restore();
    }
  }, 20_000);

  test('로컬 콜백 서버 없이 승인 결과로 config와 컨벤션을 완성한다', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const postSpy = jest.spyOn(axios, 'post');
    const { urls, restore } = captureAuthorizeUrls();

    const startBodies: Record<string, unknown>[] = [];
    globalThis.fetch = jest.fn(async (url: unknown, init: unknown) => {
      if (String(url).endsWith('/api/auth/desktop/device/start')) {
        startBodies.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
        return new Response(JSON.stringify(DEVICE_START_PAYLOAD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as unknown as typeof fetch;

    try {
      const result = await executeInitCommand({ cwd, deviceAuth: true });

      expect(result).toMatchObject({
        success: true,
        teamId: 'team-1',
        projectId: 'project-1',
        agentName: 'remote-agent',
        seedPlanId: 'plan-1',
      });
      // loopback authorize URL은 한 줄도 출력되지 않는다 = 로컬 포트를 열지 않았다.
      expect(urls).toHaveLength(0);
      expect(postSpy).not.toHaveBeenCalled();
      expect(exchangeAuthorizationCode).not.toHaveBeenCalled();

      // 러너 자동 바인딩에 필요한 메타가 start 요청에 실린다.
      expect(startBodies[0]).toMatchObject({
        flow: 'setup',
        projectName: basename(cwd),
        machineId: expect.any(String),
        authPathEnc: expect.any(String),
      });

      const config = JSON.parse(readFileSync(join(cwd, '.agentteams', 'config.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(config).toMatchObject({ teamId: 'team-1', projectId: 'project-1', authMode: 'personal-token' });
      expect(readFileSync(join(cwd, '.agentteams', 'convention.md'), 'utf-8')).toBe(CONVENTION_TEMPLATE);
    } finally {
      restore();
    }
  }, 20_000);

  test('승인 결과에 setup 메타가 없으면 명확한 오류로 끝난다', async () => {
    const { axios, executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();
    mockConventionEndpoints(axios);
    const { restore } = captureAuthorizeUrls();

    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(DEVICE_START_PAYLOAD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    pollDeviceToken.mockResolvedValueOnce({
      kind: 'approved' as const,
      session: {
        accessToken: 'atp_access_token',
        expiresAt: Date.now() + 60_000,
        identity: { memberId: 'member-1', email: 'dev@example.com', nickname: 'dev' },
      },
      setup: null,
    });

    try {
      await expect(executeInitCommand({ cwd, deviceAuth: true })).rejects.toThrow(/Initialization failed/);
      expect(existsSync(join(cwd, '.agentteams', 'config.json'))).toBe(false);
    } finally {
      restore();
    }
  }, 20_000);

  test('--device-auth와 --auth api-key 조합은 명확한 오류로 거절된다', async () => {
    const { executeInitCommand } = await loadInitModules();
    const cwd = createTempProject();

    await expect(executeInitCommand({ cwd, deviceAuth: true, authMode: 'api-key' })).rejects.toThrow(
      /--device-auth cannot be combined with --auth api-key/,
    );
  });
});
