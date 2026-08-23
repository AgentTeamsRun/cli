import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const syncResult = {
  message: 'Convention sync completed.\nDownloaded 4 file(s) into .agentteams',
  unmanagedFiles: ['.agentteams/rules/local-note.md'],
  warning:
    'Unmanaged convention files are still present: .agentteams/rules/local-note.md. Remove them manually if they are stale.',
  skills: {
    message: 'Downloaded 2 skill package(s).',
    warning: 'Local skill package copies were overwritten by the server version.',
  },
};

const executeCommand = jest.fn(async (..._args: unknown[]) => syncResult);

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

beforeEach(() => {
  executeCommand.mockClear();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  logSpy.mockRestore();
});

async function runCli(argv: string[], completed: () => boolean = () => logSpy.mock.calls.length > 0): Promise<void> {
  process.argv = ['node', 'agentteams', ...argv];
  await import('../src/index.js');

  for (let attempt = 0; attempt < 50 && !completed(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function stdout(): string {
  return (logSpy.mock.calls as unknown[][]).map((args) => args.map(String).join(' ')).join('\n');
}

describe('agentteams sync CLI output', () => {
  test('옵션이 없으면 성공과 경고를 raw JSON이 아닌 human 문장으로 출력한다', async () => {
    await runCli(['sync']);

    const output = stdout();
    expect(output).toContain('Convention sync completed.');
    expect(output).toContain('Downloaded 4 file(s) into .agentteams');
    expect(output).toContain('Unmanaged convention files are still present: .agentteams/rules/local-note.md.');
    expect(output).toContain('Downloaded 2 skill package(s).');
    expect(output).toContain('Local skill package copies were overwritten by the server version.');
    expect(output).not.toContain('{');
    expect(output).not.toContain('"unmanagedFiles"');
    expect(output.indexOf('Convention sync completed.')).toBeLessThan(output.indexOf('Unmanaged convention files'));
    expect(output.indexOf('Unmanaged convention files')).toBeLessThan(output.indexOf('Downloaded 2 skill package(s).'));
    expect(output.indexOf('Downloaded 2 skill package(s).')).toBeLessThan(output.indexOf('Local skill package copies'));
  });

  test('--format json은 전체 sync 결과 객체를 보존한다', async () => {
    await runCli(['sync', '--format', 'json']);

    expect(JSON.parse(stdout())).toEqual(syncResult);
  });

  test('--output-file은 전체 JSON을 저장하고 stdout에는 기존 요약만 출력한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentteams-sync-output-'));
    const outputFile = join(directory, 'sync.json');

    try {
      await runCli(['sync', '--output-file', outputFile], () => existsSync(outputFile));

      expect(JSON.parse(readFileSync(outputFile, 'utf-8'))).toEqual(syncResult);
      expect(stdout()).toContain(`Saved output to ${outputFile}`);
      expect(stdout()).toContain('Convention sync completed.');
      expect(stdout()).not.toContain('"unmanagedFiles"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
