import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { printInitResult } from '../src/utils/initOutput.js';

function captureOutput(spy: ReturnType<typeof jest.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
}

const MOCK_INIT_RESULT = {
  success: true as const,
  authUrl: 'https://agentteams.run/cli/authorize?port=3333',
  configPath: '/project/.agentteams/config.json',
  conventionPath: '/project/.agentteams/convention.md',
  teamId: 'team-abc',
  projectId: 'proj-xyz',
  agentName: 'claude-main',
  agentFiles: [
    { relativePath: 'CLAUDE.md', type: 'created' as const },
    { relativePath: 'AGENTS-example.md', type: 'example' as const },
  ],
  readiness: [
    { stage: 'project-binding' as const, status: 'READY' as const, issues: [] },
    { stage: 'credential' as const, status: 'READY' as const, issues: [] },
    { stage: 'convention-sync' as const, status: 'READY' as const, issues: [] },
    { stage: 'local-adapters' as const, status: 'READY' as const, issues: [] },
  ],
};

describe('printInitResult', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('human format (기본값)', () => {
    it('에이전트명을 포함한 인증 완료 메시지를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('claude-main');
    });

    it('config 파일 경로를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('/project/.agentteams/config.json');
    });

    it('convention 파일 경로를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('/project/.agentteams/convention.md');
    });

    it('Next steps 섹션을 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Next steps:');
    });

    it('에이전트 파일 생성 결과를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Agent file created: CLAUDE.md');
      expect(output).toContain('Example file created: AGENTS-example.md');
    });

    it('에이전트 파일 확인 및 example 병합 안내를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Check the generated agent files');
      expect(output).toContain('-example');
    });

    it('post-checkout 훅 설치 성공 시 워크트리 자동 부트스트랩 안내를 출력한다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          postCheckoutHook: { status: 'ready', changed: true, hookPath: '/project/.git/hooks/post-checkout' },
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Worktree bootstrap hook installed');
    });

    it('post-checkout 훅 설치 실패 시 수동 init 안내를 경고로 출력한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          postCheckoutHook: {
            status: 'blocked',
            changed: false,
            hookPath: '/project/.git/hooks/post-checkout',
            issue: {
              code: 'hook-custom',
              path: '/project/.git/hooks/post-checkout',
              message: 'An unmanaged post-checkout hook exists',
            },
          },
        },
        'human',
      );

      const warnings = captureOutput(warnSpy);
      expect(warnings).toContain('Worktree bootstrap hook not installed');
      expect(warnings).toContain('An unmanaged post-checkout hook exists');
      expect(warnings).toContain("'agentteams init' run manually");

      warnSpy.mockRestore();
    });

    it('이미 존재해 건너뛴 진입점 파일을 만들었다고 말하지 않는다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          agentFiles: [{ relativePath: 'CLAUDE.md', type: 'skipped' as const }],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Agent file already exists, left untouched: CLAUDE.md');
      expect(output).not.toContain('Agent file created: CLAUDE.md');
    });

    // 훅을 안 깔았다는 사실만 남고 되돌리는 방법이 없으면, 사용자는 워크트리 부트스트랩이
    // 왜 안 도는지 알 길이 없다. SKIPPED도 이유를 출력해야 한다.
    it('SKIPPED 단계의 사유와 복구 명령을 함께 출력한다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          readiness: [
            {
              stage: 'local-adapters' as const,
              status: 'SKIPPED' as const,
              issues: [
                {
                  code: 'post-checkout-hook-no-worktrees',
                  message:
                    "This repository has no linked git worktrees, so the worktree bootstrap hook was not installed. Run 'agentteams doctor' to install it.",
                },
              ],
            },
          ],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('[SKIPPED] local-adapters');
      expect(output).toContain('agentteams doctor');
    });

    // local-adapters 롤업은 어댑터 하나만 성공해도 READY가 된다(.gitignore는 항상
    // 성공한다). 그래서 READY일 때 issues를 안 찍으면, 진입점 0개·훅 미설치로 끝난
    // 실행이 초록 한 줄로 끝나고 사유는 JSON에만 남는다.
    it('READY 단계의 스킵 사유도 화면에 출력한다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          agentFiles: [],
          readiness: [
            {
              stage: 'local-adapters' as const,
              status: 'READY' as const,
              issues: [
                { code: 'agent-entry-points-not-selected', message: 'No agent entry point file was created.' },
                {
                  code: 'post-checkout-hook-no-worktrees',
                  message: 'This repository has no linked git worktrees, so the hook was not installed.',
                },
              ],
            },
          ],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('[READY] local-adapters');
      expect(output).toContain('No agent entry point file was created.');
      expect(output).toContain('no linked git worktrees');
    });

    // 만들지도 않은 파일을 "확인하라"고 하면 사용자는 없는 CLAUDE.md를 찾아 헤맨다.
    it('진입점을 하나도 만들지 않았으면 Next steps가 생성 방법을 안내한다', () => {
      printInitResult({ ...MOCK_INIT_RESULT, agentFiles: [] }, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('No agent entry point file was created in this run.');
      expect(output).toContain('agentteams init --agent-files CLAUDE.md');
      expect(output).not.toContain('Check the generated agent files');
    });

    it('post-checkout 훅 필드가 없으면 훅 관련 출력을 하지 않는다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).not.toContain('Worktree bootstrap hook');
    });

    it('seed plan ID를 agentteams_ 네임스페이스 prefix로 출력한다', () => {
      printInitResult({ ...MOCK_INIT_RESULT, seedPlanId: '123e4567-e89b-12d3-a456-426614174000' }, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('agentteams_pln_123e4567-e89b-12d3-a456-426614174000');
      expect(output).not.toContain('agentteams_plan_123e4567-e89b-12d3-a456-426614174000');
      expect(output).not.toContain('Start plan plan_123e4567-e89b-12d3-a456-426614174000');
    });

    it('worktree 부트스트랩 결과와 링크 원본을 출력한다', () => {
      printInitResult(
        {
          success: true,
          mode: 'worktree',
          worktreePath: '/worktrees/feature',
          sourcePath: '/project/.agentteams',
          targetPath: '/worktrees/feature/.agentteams',
          materialization: 'symlink',
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Detected a linked git worktree');
      expect(output).toContain('Source: /project/.agentteams');
      expect(output).toContain('OAuth and interactive prompts were skipped');
    });

    it('worktree 진입점 상태와 issue를 출력한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      printInitResult(
        {
          success: true,
          mode: 'worktree',
          worktreePath: '/worktrees/feature',
          sourcePath: '/project/.agentteams',
          targetPath: '/worktrees/feature/.agentteams',
          materialization: 'symlink',
          entryPoints: [
            { relativePath: 'CLAUDE.md', state: 'created' },
            { relativePath: 'AGENTS.md', state: 'tracked' },
            { relativePath: 'GEMINI.md', state: 'existing' },
            { relativePath: '.cursor/rules/agentteams.mdc', state: 'blocked' },
          ],
          issues: [
            {
              code: 'exclude-write-failed',
              path: '/repo/.git/info/exclude',
              message: 'Could not update /repo/.git/info/exclude: EACCES',
            },
          ],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Agent entry point created: CLAUDE.md');
      expect(output).toContain('Agent entry point already tracked: AGENTS.md');
      expect(output).toContain('Agent entry point already exists: GEMINI.md');

      const warnings = captureOutput(warnSpy);
      expect(warnings).toContain('Agent entry point skipped: .cursor/rules/agentteams.mdc');
      expect(warnings).toContain('Could not update /repo/.git/info/exclude: EACCES');

      warnSpy.mockRestore();
    });

    it('configured-project readiness와 재시도 명령을 배열 그대로 출력한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      printInitResult(
        {
          success: true,
          mode: 'configured-project',
          configPath: '/project/.agentteams/config.json',
          conventionPath: '/project/.agentteams/convention.md',
          conventionsUpdated: false,
          doctor: { status: 'NOT_APPLICABLE', issues: [] },
          readiness: [
            { stage: 'project-binding', status: 'READY', issues: [] },
            { stage: 'credential', status: 'READY', issues: [] },
            {
              stage: 'convention-sync',
              status: 'DEGRADED',
              issues: [{ code: 'sync-failed', message: 'Network unavailable' }],
              retryCommand: 'agentteams convention download',
            },
            { stage: 'local-adapters', status: 'SKIPPED', issues: [] },
          ],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      const warnings = captureOutput(warnSpy);
      expect(output).toContain('[READY] project-binding');
      expect(output).toContain('[SKIPPED] local-adapters');
      expect(warnings).toContain('[DEGRADED] convention-sync');
      expect(warnings).toContain('Retry: agentteams convention download');

      warnSpy.mockRestore();
    });

    // 체크 표시와 바로 아래 readiness가 서로 다른 말을 하면, 로그를 훑는 사용자에게는
    // 정상 완료로 읽힌다. 로컬 어댑터 줄은 doctor 판정을 그대로 따라야 한다.
    it('doctor가 READY가 아니면 로컬 어댑터 체크 표시를 찍지 않는다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const base = {
        success: true,
        mode: 'configured-project',
        configPath: '/project/.agentteams/config.json',
        conventionPath: '/project/.agentteams/convention.md',
        conventionsUpdated: false,
        readiness: [{ stage: 'local-adapters', status: 'DEGRADED', issues: [], retryCommand: 'agentteams doctor' }],
      };

      printInitResult({ ...base, doctor: { status: 'DEGRADED', issues: [] } }, 'human');

      expect(captureOutput(logSpy)).not.toContain('✓ Local adapters checked');
      expect(captureOutput(warnSpy)).toContain('Local adapters still need attention');

      logSpy.mockClear();
      warnSpy.mockClear();

      printInitResult({ ...base, doctor: { status: 'READY', issues: [] } }, 'human');

      expect(captureOutput(logSpy)).toContain('✓ Local adapters checked by agentteams doctor.');

      warnSpy.mockRestore();
    });
  });

  describe('개인 토큰 경로 (human format)', () => {
    it('로그인 계정과 "키를 만들지 않았다"는 사실을 사람용 출력에 표시한다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          authMode: 'personal-token' as const,
          personalLogin: { email: 'dev@example.com', nickname: 'dev', persisted: true },
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('dev@example.com');
      expect(output).toContain('OS credential store');
      // 이 경로는 setup 키를 발급하지 않으므로 "폐기했다"가 아니라 "만들지 않았다"가 참이다.
      expect(output).toContain('No agent API key was created');
      expect(output).not.toContain('revoked');
    });

    it('파일 fallback으로 저장됐으면 "OS 저장소에 저장됨"이라고 단정하지 않는다', () => {
      // 원격 세션에서 실제 저장 위치를 잘못 알려 주면, 사용자는 존재하지 않는
      // 키체인 항목을 지우러 가고 실제 토큰은 파일에 남는다.
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          authMode: 'personal-token' as const,
          personalLogin: {
            email: 'dev@example.com',
            nickname: 'dev',
            persisted: true,
            storeBackend: 'protected-file',
          },
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('~/.agentteams/credentials');
      expect(output).toContain('weaker than the OS keyring');
      expect(output).not.toContain('Login stored in the OS credential store');
    });

    it('경고는 기본 포맷에서 반드시 보인다', () => {
      // 기본 실행이 사람용 포맷이므로, --format json에서만 보이는 경고는 아무도 읽지 않는다.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          authMode: 'personal-token' as const,
          personalLogin: { email: 'dev@example.com', nickname: 'dev', persisted: true },
          warning: 'The convention sync finished with a partial result.',
        },
        'human',
      );

      expect(captureOutput(warnSpy)).toContain('partial result');

      warnSpy.mockRestore();
    });
  });

  describe('json format', () => {
    it('json 포맷이면 JSON 문자열을 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'json');

      const output = captureOutput(logSpy);
      expect(output).toContain('"agentName"');
      expect(output).toContain('"claude-main"');
    });

    it('json 포맷이면 온보딩 요약 메시지를 출력하지 않는다', () => {
      printInitResult(MOCK_INIT_RESULT, 'json');

      const output = captureOutput(logSpy);
      expect(output).not.toContain('Next steps:');
    });

    it('기존 필드를 유지하면서 4단계 readiness를 추가한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'json');

      const parsed = JSON.parse(captureOutput(logSpy)) as Record<string, unknown>;
      for (const key of Object.keys(MOCK_INIT_RESULT)) {
        expect(parsed).toHaveProperty(key);
      }
      expect(parsed.readiness).toHaveLength(4);
      expect(parsed.readiness).toEqual(MOCK_INIT_RESULT.readiness);
    });

    // localAdapters는 추가 필드다. 기존 소비자가 읽던 키가 하나라도 사라지면 안 된다.
    it('어댑터 상태는 기존 필드를 건드리지 않고 추가만 한다', () => {
      const localAdapters = [
        { adapter: 'gitignore', status: 'READY', issues: [] },
        {
          adapter: 'post-checkout-hook',
          status: 'SKIPPED',
          issues: [{ code: 'post-checkout-hook-no-worktrees', message: "Run 'agentteams doctor' to install it." }],
        },
      ];

      printInitResult({ ...MOCK_INIT_RESULT, localAdapters }, 'json');

      const parsed = JSON.parse(captureOutput(logSpy)) as Record<string, unknown>;
      for (const key of Object.keys(MOCK_INIT_RESULT)) {
        expect(parsed).toHaveProperty(key);
      }
      expect(parsed.localAdapters).toEqual(localAdapters);
    });
  });
});
