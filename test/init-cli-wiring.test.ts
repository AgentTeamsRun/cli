/**
 * `agentteams init`의 실제 배선을 그대로 통과시키는 회귀 테스트.
 *
 * `executeInitCommand`를 직접 호출하는 테스트는 commander 옵션 정의를 지나치지 않는다.
 * `--auth`에 기본값이 걸려 있으면 사용자가 플래그를 안 줘도 `authMode`가 항상 채워져
 * `detectInitExecutionContext`가 이를 "명시적 relink 요청"으로 읽고, configured-project
 * fast path가 CLI에서 영영 선택되지 않는다. 그래서 여기서는 entry 모듈(`src/index.ts`)을
 * argv와 함께 import해 실제 파싱 결과를 검증한다.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const executeCommand = jest.fn(async (..._args: unknown[]) => ({
  success: true,
  mode: 'configured-project',
  configPath: '/project/.agentteams/config.json',
  conventionPath: '/project/.agentteams/convention.md',
  conventionsUpdated: false,
  readiness: [],
}));

jest.unstable_mockModule('../src/commands/index.js', () => ({
  __esModule: true,
  executeCommand,
}));

jest.unstable_mockModule('../src/utils/updateCheck.js', () => ({
  __esModule: true,
  compareVersions: () => false,
  formatUpdateMessage: () => '',
  getLatestCliVersion: async () => null,
  readCache: () => null,
  startUpdateCheck: () => undefined,
  writeCache: () => {},
}));

const originalArgv = process.argv;
let logSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  executeCommand.mockClear();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

/** entry 모듈은 import 시점에 `program.parse()`를 실행하므로, argv를 먼저 세운다. */
async function runCli(argv: string[]): Promise<void> {
  process.argv = ['node', 'agentteams', ...argv];
  await import('../src/index.js');
  // action 콜백이 async라 parse()는 완료를 기다리지 않는다.
  for (let attempt = 0; attempt < 50 && executeCommand.mock.calls.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('agentteams init CLI wiring', () => {
  test('플래그가 없으면 authMode를 채우지 않아 fast path 분류가 가능하다', async () => {
    await runCli(['init']);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const [resource, action, options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(resource).toBe('init');
    expect(action).toBe('start');
    expect(options.authMode).toBeUndefined();
  });

  test('사용자가 --auth를 명시하면 그 값이 그대로 전달된다', async () => {
    await runCli(['init', '--auth', 'api-key']);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.authMode).toBe('api-key');
  });

  test('--auth personal-token도 명시로 취급되어 relink 경로를 탄다', async () => {
    await runCli(['init', '--auth', 'personal-token']);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.authMode).toBe('personal-token');
  });

  // 어댑터 옵션은 커맨드 정의를 지나야 실제로 전달된다. 여기서 끊기면 감지 폴백이
  // 명시 선택을 덮어써 사용자가 지정한 것과 다른 파일 집합이 만들어진다.
  test('진입점/훅 옵션이 없으면 어댑터 기본값이 그대로 전달된다', async () => {
    await runCli(['init']);

    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.agentFiles).toBeUndefined();
    expect(options.agentFilesExample).toBe(false);
    expect(options.installWorktreeHook).toBe(false);
  });

  // 두 명령이 같은 이름의 플래그를 노출해야 한다. 한쪽에서 배운 플래그를 다른 쪽에서
  // 그대로 칠 수 있어야 하고, 이름이 갈리면 사용자는 매번 --help를 다시 읽어야 한다.
  test('--device-auth / --set-default가 init에서 그대로 전달된다', async () => {
    await runCli(['init', '--device-auth', '--set-default']);

    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.deviceAuth).toBe(true);
    expect(options.setDefault).toBe(true);
  });

  test('플래그가 없으면 device 흐름은 선택되지 않는다', async () => {
    await runCli(['init']);

    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.deviceAuth).toBe(false);
    expect(options.setDefault).toBe(false);
  });

  test('auth login도 같은 이름의 --device-auth를 노출한다', async () => {
    await runCli(['auth', 'login', '--device-auth']);

    const [resource, action, options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(resource).toBe('auth');
    expect(action).toBe('login');
    expect(options.deviceAuth).toBe(true);
  });

  test('--agent-files / --agent-files-example / --install-worktree-hook가 그대로 전달된다', async () => {
    await runCli(['init', '--agent-files', 'CLAUDE.md,AGENTS.md', '--agent-files-example', '--install-worktree-hook']);

    const [, , options] = executeCommand.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options.agentFiles).toBe('CLAUDE.md,AGENTS.md');
    expect(options.agentFilesExample).toBe(true);
    expect(options.installWorktreeHook).toBe(true);
  });
});
