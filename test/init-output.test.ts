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

    // 기존 파일이 있어 건너뛴 경우, 그 파일에는 컨벤션을 가리키는 줄이 아직 없다.
    // "left untouched"는 상태일 뿐이고, 사용자가 무엇을 해야 하는지가 남아야 한다.
    it('건너뛴 진입점이 있으면 파일 경로와 직접 추가 안내를 출력한다', () => {
      printInitResult(
        { ...MOCK_INIT_RESULT, agentFiles: [{ relativePath: 'CLAUDE.md', type: 'skipped' as const }] },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('already existed and was left untouched (CLAUDE.md)');
      expect(output).toContain('Nothing in CLAUDE.md points at the conventions yet.');
      expect(output).toContain('.agentteams/convention.md');
      expect(output).toContain('--agent-files-example');
      // 파일은 이미 있다. 같은 명령을 다시 돌리라는 안내는 같은 skip을 반복시킬 뿐이다.
      expect(output).not.toContain('No agent entry point file was created in this run.');
      expect(output).not.toContain('Check the generated agent files');
    });

    // 만들지도 않은 -example 파일을 병합하라고 하면 사용자는 없는 파일을 찾는다.
    // `--agent-files-example` 없이는 그 파일이 애초에 생성되지 않는다.
    it('example 파일이 없으면 병합 안내를 출력하지 않는다', () => {
      printInitResult(
        { ...MOCK_INIT_RESULT, agentFiles: [{ relativePath: 'CLAUDE.md', type: 'created' as const }] },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Check the generated agent files (CLAUDE.md)');
      expect(output).not.toContain('Merge each -example file');
    });

    it('example 파일이 실제로 생성되면 병합 안내가 그 파일을 지목한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Merge each -example file into the file it sits next to (AGENTS-example.md).');
    });

    // 쓴 파일과 건너뛴 파일이 함께 나온 실행에서는 둘 다 안내가 남아야 한다.
    it('일부만 건너뛴 경우 생성 안내와 건너뜀 안내를 함께 출력한다', () => {
      printInitResult(
        {
          ...MOCK_INIT_RESULT,
          agentFiles: [
            { relativePath: 'AGENTS.md', type: 'created' as const },
            { relativePath: 'CLAUDE.md', type: 'skipped' as const },
          ],
        },
        'human',
      );

      const output = captureOutput(logSpy);
      expect(output).toContain('Check the generated agent files (AGENTS.md)');
      expect(output).toContain('Nothing in CLAUDE.md points at the conventions yet.');
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

  describe('MCP 등록 (human format)', () => {
    const mcpResult = (overrides: Record<string, unknown> = {}) => ({
      scope: 'project' as const,
      summary: { applied: 1, skipped: 9, failed: 1 },
      clients: [
        {
          clientId: 'cursor-cli',
          outcome: 'INSTALLED' as const,
          detail: 'Added "agentteams" to /project/.cursor/mcp.json.',
          configPath: '/project/.cursor/mcp.json',
        },
        {
          clientId: 'codex',
          outcome: 'SKIPPED_CONFIG_ONLY' as const,
          detail: 'Codex project config is TOML.',
          configPath: '/project/.codex/config.toml',
          manualSnippet: '[mcp_servers.agentteams]',
        },
        {
          clientId: 'claude-code',
          outcome: 'FAILED' as const,
          detail: '`claude mcp add` exited with code 9',
          configPath: '/project/.mcp.json',
        },
        {
          clientId: 'amp',
          outcome: 'SKIPPED_NOT_DETECTED' as const,
          detail: 'Not detected on this machine.',
          configPath: '/project/.vscode/settings.json',
        },
      ],
      ...overrides,
    });

    // --mcp 없이 실행한 init은 클라이언트 설정을 쓰지 않으므로, 남는 것은 안내 한 줄뿐이다.
    it('MCP 결과가 없으면 Next steps에서 mcp install을 안내한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('agentteams mcp install');
      expect(output).not.toContain('MCP registration (project scope):');
    });

    it('클라이언트별 성공·수동 설정·실패를 요약과 함께 출력한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        printInitResult({ ...MOCK_INIT_RESULT, mcp: mcpResult() }, 'human');

        const output = `${captureOutput(logSpy)}\n${captureOutput(warnSpy)}`;
        expect(output).toContain('MCP registration (project scope):');
        expect(output).toContain('cursor-cli');
        expect(output).toContain('codex');
        expect(output).toContain('agentteams mcp config --client codex');
        expect(output).toContain('claude-code');
        expect(output).toContain('agentteams mcp install --client claude-code');
        expect(output).toContain('1 registered, 9 skipped, 1 failed.');
        // 감지되지 않은 클라이언트는 줄로 나열하지 않고 개수로만 알린다.
        expect(output).not.toContain('amp:');
        // 이미 실행된 뒤에 같은 명령을 다시 권하면 실패한 것처럼 읽힌다.
        expect(output).not.toContain('4. Connect your AI tools');
      } finally {
        warnSpy.mockRestore();
      }
    });

    // 설정 흔적은 있는데 CLI가 PATH에 없는 클라이언트를 "감지되지 않음"에 섞으면,
    // 목록에서 사라진 채 개수에만 잡혀 사용자는 사실과 다른 문구만 보게 된다.
    it('실행 파일이 없어 건너뛴 클라이언트를 개수가 아니라 줄로 안내한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        printInitResult(
          {
            ...MOCK_INIT_RESULT,
            mcp: mcpResult({
              clients: [
                {
                  clientId: 'claude-code',
                  outcome: 'SKIPPED_NO_EXECUTABLE' as const,
                  detail: 'Detected from configuration only; no `claude` executable was found.',
                  configPath: '/project/.mcp.json',
                },
                {
                  clientId: 'amp',
                  outcome: 'SKIPPED_NOT_DETECTED' as const,
                  detail: 'Not detected on this machine.',
                  configPath: '/project/.vscode/settings.json',
                },
              ],
            }),
          },
          'human',
        );

        const output = `${captureOutput(logSpy)}\n${captureOutput(warnSpy)}`;
        expect(output).toContain('claude-code: Detected from configuration only');
        expect(output).toContain('Put its CLI on PATH and re-run: agentteams mcp install --client claude-code');
        // 진짜로 없는 클라이언트만 개수로 접힌다.
        expect(output).toContain('1 supported client(s) were not detected in this environment.');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('MCP 등록이 아예 실행되지 못해도 init 출력은 성공 경로를 유지한다', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        printInitResult(
          { ...MOCK_INIT_RESULT, mcp: mcpResult({ clients: [], error: 'No AgentTeams configuration was found.' }) },
          'human',
        );

        const output = `${captureOutput(logSpy)}\n${captureOutput(warnSpy)}`;
        expect(output).toContain('Registration could not run: No AgentTeams configuration was found.');
        expect(output).toContain('Retry: agentteams mcp install');
        expect(output).toContain('Next steps:');
      } finally {
        warnSpy.mockRestore();
      }
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
    // MCP 결과가 human 전용이면 --format json 소비자는 무엇이 등록됐는지 알 수 없다.
    it('MCP 등록 결과를 JSON 페이로드에도 포함한다', () => {
      const mcp = {
        scope: 'project',
        summary: { applied: 1, skipped: 10, failed: 0 },
        clients: [
          {
            clientId: 'cursor-cli',
            outcome: 'INSTALLED',
            detail: 'Added "agentteams" to /project/.cursor/mcp.json.',
            configPath: '/project/.cursor/mcp.json',
          },
        ],
      };

      printInitResult({ ...MOCK_INIT_RESULT, mcp }, 'json');

      const parsed = JSON.parse(captureOutput(logSpy)) as Record<string, unknown>;
      expect(parsed.mcp).toEqual(mcp);
    });

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
