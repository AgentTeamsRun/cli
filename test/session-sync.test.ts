import { afterEach, beforeEach, describe, it, expect, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diffConventionSnapshots,
  formatClaudeCodeSessionStartHook,
  sessionSync,
  snapshotConventionFiles,
  type SessionSyncResult,
} from '../src/commands/session.js';

// 훅 배선 테스트는 commander를 실제로 통과시키되 라우팅만 가로챈다. 기본 구현은 진짜
// `sessionSync`로 넘겨, 프로젝트 밖 판정 같은 실제 결과가 그대로 흐르게 한다.
const executeCommand = jest.fn(async (_resource: string, _action: string, options: { cwd?: string }) =>
  sessionSync({ cwd: options.cwd }),
);
jest.unstable_mockModule('../src/commands/index.js', () => ({ __esModule: true, executeCommand }));

let projectRoot = '';

const write = (relativePath: string, content: string) => {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
};

const rule = (trigger: string, body: string) => `---\ntrigger: ${trigger}\n---\n\n${body}\n`;

/** 매니페스트에 등재된 파일만 스냅샷 대상이 된다 — 실제 다운로드가 쓰는 형식 그대로 만든다. */
const writeManifest = (paths: string[]) => {
  write(
    '.agentteams/conventions.manifest.json',
    JSON.stringify({
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      entries: paths.map((path, index) => ({
        conventionId: `c${index}`,
        fileRelativePath: path,
        fileName: path.split('/').pop(),
        categoryDir: 'rules',
        downloadedAt: '2026-01-01T00:00:00.000Z',
      })),
    }),
  );
};

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'agentteams-session-sync-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('snapshotConventionFiles', () => {
  it('reads the trigger of every deployed convention file', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'ko'));
    write('.agentteams/rules/schema.md', rule('model_decision', 'prisma'));
    writeManifest(['.agentteams/rules/context.md', '.agentteams/rules/schema.md']);

    const snapshot = snapshotConventionFiles(projectRoot);
    expect(snapshot.get('.agentteams/rules/context.md')?.alwaysOn).toBe(true);
    expect(snapshot.get('.agentteams/rules/schema.md')?.alwaysOn).toBe(false);
  });

  // convention.md는 매니페스트 엔트리가 아니라 별도 경로로 배포된다. 매니페스트만 훑으면
  // always_on인 이 파일이 재독 대상에서 통째로 빠진다.
  it('includes convention.md even though the manifest never lists it', () => {
    write('.agentteams/convention.md', rule('always_on', '# AgentTeams Convention'));
    writeManifest([]);

    expect(snapshotConventionFiles(projectRoot).has('.agentteams/convention.md')).toBe(true);
  });

  it('treats a file with broken frontmatter as not always-on instead of throwing', () => {
    write('.agentteams/rules/broken.md', '---\ntrigger: [unclosed\n---\nbody\n');
    writeManifest(['.agentteams/rules/broken.md']);

    const snapshot = snapshotConventionFiles(projectRoot);
    expect(snapshot.get('.agentteams/rules/broken.md')?.alwaysOn).toBe(false);
  });

  it('omits files the manifest lists but that are not on disk', () => {
    writeManifest(['.agentteams/rules/gone.md']);
    expect(snapshotConventionFiles(projectRoot).size).toBe(0);
  });
});

describe('diffConventionSnapshots', () => {
  const snapshotOf = (paths: string[]) => {
    writeManifest(paths.filter((path) => !path.endsWith('convention.md')));
    return snapshotConventionFiles(projectRoot);
  };

  it('lists an always-on file whose bytes changed, and leaves untouched ones out', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'v1'));
    write('.agentteams/rules/my.md', rule('always_on', 'same'));
    const before = snapshotOf(['.agentteams/rules/context.md', '.agentteams/rules/my.md']);

    write('.agentteams/rules/context.md', rule('always_on', 'v2'));
    const after = snapshotOf(['.agentteams/rules/context.md', '.agentteams/rules/my.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual(['.agentteams/rules/context.md']);
  });

  // model_decision은 필요할 때 여는 등급이다. 세션 시작에 재독시키면 always_on을 늘린 셈이 된다.
  it('ignores a changed model_decision file', () => {
    write('.agentteams/rules/schema.md', rule('model_decision', 'v1'));
    const before = snapshotOf(['.agentteams/rules/schema.md']);

    write('.agentteams/rules/schema.md', rule('model_decision', 'v2'));
    const after = snapshotOf(['.agentteams/rules/schema.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual([]);
  });

  it('lists a newly deployed always-on file', () => {
    const before = snapshotOf([]);
    write('.agentteams/rules/new.md', rule('always_on', 'fresh'));
    const after = snapshotOf(['.agentteams/rules/new.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual(['.agentteams/rules/new.md']);
  });

  // 사라진 규칙은 재독할 파일이 없다. 그래도 에이전트 컨텍스트에는 남아 있으므로 신호가 필요하다.
  it('reports a removed always-on file as invalidated, not as reread', () => {
    write('.agentteams/rules/legacy.md', rule('always_on', 'old'));
    const before = snapshotOf(['.agentteams/rules/legacy.md']);

    unlinkSync(join(projectRoot, '.agentteams/rules/legacy.md'));
    const after = snapshotOf([]);

    const result = diffConventionSnapshots(before, after);
    expect(result.reread).toEqual([]);
    expect(result.invalidated).toEqual(['.agentteams/rules/legacy.md']);
  });

  it('reports nothing when the deployed bytes are identical', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'stable'));
    const before = snapshotOf(['.agentteams/rules/context.md']);
    const after = snapshotOf(['.agentteams/rules/context.md']);

    expect(diffConventionSnapshots(before, after)).toEqual({ reread: [], invalidated: [] });
  });
});

describe('sessionSync', () => {
  // 스킬 목록이 바뀌면 convention.md의 Skill Index도 달라진다. `checkConventionFreshness`는 그
  // 축을 보지 않으므로(컨벤션 레코드와 플랫폼 가이드 해시만 본다), 스킬만 바뀐 세션에서
  // 컨벤션을 다시 받지 않으면 인덱스가 낡은 채로 남는다. 순서도 중요하다 — 컨벤션 다운로드가
  // 스킬 동기화보다 앞서면 방금 바뀐 스킬이 빠진 인덱스를 받는다.
  it('re-downloads the convention after skills change, and does so in that order', () => {
    const source = readFileSync(new URL('../src/commands/session.ts', import.meta.url), 'utf8');

    const skillsAt = source.indexOf('await syncSkills(');
    const conventionAt = source.indexOf('await conventionDownload(');
    expect(skillsAt).toBeGreaterThan(-1);
    expect(conventionAt).toBeGreaterThan(-1);
    expect(skillsAt).toBeLessThan(conventionAt);
    expect(source).toMatch(/conventionUpdateAvailable \|\| synced\.platformGuides \|\| synced\.skills/);
  });

  // 세션 시작을 막지 않는 것이 이 명령의 첫 번째 계약이다. 미설정 프로젝트에서 던지면
  // 에이전트가 본 작업을 시작도 못 하고 멈춘다.
  it('returns a clean result without any network call when the directory is not a project', async () => {
    const result = await sessionSync({ cwd: projectRoot });

    expect(result.reread).toEqual([]);
    expect(result.invalidated).toEqual([]);
    expect(result.synced).toEqual({ conventions: false, skills: false, platformGuides: false });
    expect(result.cliUpdateAvailable).toBe(false);
    expect(result.notes).toEqual(['Not an AgentTeams project — nothing to sync.']);
  });
});

const syncResult = (overrides: Partial<SessionSyncResult> = {}): SessionSyncResult => ({
  reread: [],
  invalidated: [],
  synced: { conventions: false, skills: false, platformGuides: false },
  cliUpdateAvailable: false,
  notes: [],
  skillConflicts: 0,
  summary: '✓ Up to date',
  ...overrides,
});

const parseHook = (result: SessionSyncResult) => {
  const payload = formatClaudeCodeSessionStartHook(result);
  expect(payload).not.toBeNull();
  const parsed = JSON.parse(payload as string) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return parsed.hookSpecificOutput.additionalContext;
};

describe('formatClaudeCodeSessionStartHook', () => {
  // 훅이 이미 돌았는데 에이전트가 convention.md의 Session Start 절을 따라 한 번 더 부르면 중복이다.
  it('opens with the already-ran line and falls back to the summary when there is nothing else', () => {
    const lines = parseHook(syncResult()).split('\n');

    expect(lines[0]).toContain('already ran at session start');
    expect(lines[0]).toContain("do not run 'agentteams session sync' again");
    expect(lines).toEqual([lines[0], '✓ Up to date']);
  });

  it.each<[string, Partial<SessionSyncResult>, string[]]>([
    ['reread only', { reread: ['.agentteams/convention.md'] }, ['re-read these files', '- .agentteams/convention.md']],
    [
      'invalidated only',
      { invalidated: ['.agentteams/rules/legacy.md'] },
      ['no longer apply', '- .agentteams/rules/legacy.md'],
    ],
    ['notes only', { notes: ['Skill check skipped: offline'] }, ['- Skill check skipped: offline']],
    [
      'skill conflicts with notes',
      { skillConflicts: 2, notes: ['Preserved dev-cli: local edits'] },
      ['2 skill package(s) preserved', '- Preserved dev-cli: local edits'],
    ],
    [
      'everything at once',
      {
        reread: ['.agentteams/rules/context.md', '.agentteams/rules/my.md'],
        invalidated: ['.agentteams/rules/legacy.md'],
        skillConflicts: 1,
        notes: ['Convention download failed: timeout'],
      },
      [
        '- .agentteams/rules/context.md',
        '- .agentteams/rules/my.md',
        '- .agentteams/rules/legacy.md',
        '1 skill package(s) preserved',
        '- Convention download failed: timeout',
      ],
    ],
  ])('carries every item for %s, and drops the summary', (_label, overrides, expected) => {
    const context = parseHook(syncResult({ ...overrides, summary: 'SUMMARY-MARKER' }));

    for (const text of expected) expect(context).toContain(text);
    expect(context).not.toContain('SUMMARY-MARKER');
  });

  // 전역 설치는 사용자 판단이다. 에이전트에게는 사용자에게 알리라고만 한다.
  it('adds the CLI update line only when an update is available', () => {
    const withUpdate = parseHook(syncResult({ cliUpdateAvailable: true }));
    expect(withUpdate).toContain('npm install -g @agentteams/cli');
    expect(withUpdate).toContain('tell the user');

    expect(parseHook(syncResult({ cliUpdateAvailable: false }))).not.toContain('npm install -g @agentteams/cli');
  });

  it('returns null outside an AgentTeams project', () => {
    expect(
      formatClaudeCodeSessionStartHook(syncResult({ notes: ['Not an AgentTeams project — nothing to sync.'] })),
    ).toBe(null);
  });
});

describe('session sync --hook claude-code', () => {
  let stdout = '';
  let stderr = '';
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let consoleLogSpy: ReturnType<typeof jest.spyOn>;
  let exitSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    stdout = '';
    stderr = '';
    executeCommand.mockClear();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout += `${args.join(' ')}\n`;
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr += `${args.join(' ')}\n`;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const runSessionSync = async (args: string[]) => {
    const { Command } = await import('commander');
    const { registerSessionCommand } = await import('../src/program/session.js');
    const program = new Command('agentteams').exitOverride();
    registerSessionCommand(program);
    await program.parseAsync(['node', 'agentteams', 'session', 'sync', '--cwd', projectRoot, ...args], {
      from: 'node',
    });
  };

  // Claude Code는 훅 stdout을 JSON으로 파싱한다. 출력 정책의 요약 텍스트가 섞이면 주입이 깨진다.
  it('writes exactly one JSON line, bypassing the output policy even with --output-file', async () => {
    executeCommand.mockResolvedValueOnce(syncResult({ reread: ['.agentteams/convention.md'] }));

    await runSessionSync(['--hook', 'claude-code', '--output-file', join(projectRoot, 'out.json')]);

    const lines = stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('- .agentteams/convention.md');
  });

  // 훅은 사용자 설정에 걸려 모든 저장소에서 돈다. 무관한 세션에는 아무것도 주입하지 않는다.
  it('prints nothing outside an AgentTeams project', async () => {
    await runSessionSync(['--hook', 'claude-code']);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(stdout).toBe('');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // non-zero 종료는 매 세션 시작에 `hook error` 알림을 띄운다.
  it('swallows a routing failure: exit code 0, one stderr line, empty stdout', async () => {
    executeCommand.mockRejectedValueOnce(new Error('routing broke\nsecond line'));

    await runSessionSync(['--hook', 'claude-code']);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('AgentTeams session sync hook failed: routing broke second line\n');
  });

  it('ends a stalled hook after 15 seconds with manual sync context and exit 0', async () => {
    // 모듈 로딩은 가짜 타이머를 켜기 전에 끝낸다.
    await import('../src/program/session.js');
    jest.useFakeTimers();
    let finishSync!: (result: SessionSyncResult) => void;
    executeCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );
    stdoutSpy.mockImplementation((chunk: string | Uint8Array, callback?: () => void) => {
      stdout += String(chunk);
      callback?.();
      return true;
    });
    try {
      const running = runSessionSync(['--hook', 'claude-code']);
      await jest.advanceTimersByTimeAsync(14_999);
      expect(stdout).toBe('');
      await jest.advanceTimersByTimeAsync(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
      const payload = JSON.parse(stdout);
      expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(payload.hookSpecificOutput.additionalContext).toContain('did not finish');
      expect(payload.hookSpecificOutput.additionalContext).toContain("run 'agentteams session sync' manually");
      expect(stdout).not.toContain('do not run');
      finishSync(syncResult({}));
      await running;
      expect(stdout.trim().split('\n')).toHaveLength(1);
    } finally {
      finishSync?.(syncResult({}));
      jest.useRealTimers();
    }
  });

  it('rejects an unknown hook client', async () => {
    await expect(runSessionSync(['--hook', 'cursor'])).rejects.toMatchObject({
      code: 'commander.invalidArgument',
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  // 플래그 없는 경로의 계약은 그대로다: 결과 JSON 전체를 출력하고, 라우팅 실패는 exit 1.
  it('leaves the plain session sync output and exit code unchanged', async () => {
    await runSessionSync([]);
    expect(JSON.parse(stdout)).toMatchObject({ notes: ['Not an AgentTeams project — nothing to sync.'] });

    executeCommand.mockRejectedValueOnce(new Error('routing broke'));
    await runSessionSync([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
