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
};

describe('printInitResult', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('text format (기본값)', () => {
    it('에이전트명을 포함한 인증 완료 메시지를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('claude-main');
    });

    it('config 파일 경로를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('/project/.agentteams/config.json');
    });

    it('convention 파일 경로를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('/project/.agentteams/convention.md');
    });

    it('Next steps 섹션을 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('Next steps:');
    });

    it('에이전트 파일 생성 결과를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('Agent file created: CLAUDE.md');
      expect(output).toContain('Example file created: AGENTS-example.md');
    });

    it('에이전트 파일 확인 및 example 병합 안내를 출력한다', () => {
      printInitResult(MOCK_INIT_RESULT, 'text');

      const output = captureOutput(logSpy);
      expect(output).toContain('Check the generated agent files');
      expect(output).toContain('-example');
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
  });
});
