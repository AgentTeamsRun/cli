import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executePlanCommand } from '../src/commands/plan.js';

describe('plan quick with completion report integration', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plan-quick-report-'));
  const reportFile = join(tmp, 'report.md');
  const uploadDir = join(tmp, '.agentteams', 'cli', 'temp');
  const planFile = join(uploadDir, 'plan.md');
  const uploadReportFile = join(uploadDir, 'report.md');
  writeFileSync(reportFile, '# Report\n\n' + 'Did the work. '.repeat(10), 'utf-8');
  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;
  let axiosGetSpy: jest.SpiedFunction<typeof axios.get>;
  const originalAgentName = process.env.AGENTTEAMS_AGENT_NAME;

  beforeEach(() => {
    jest.restoreAllMocks();
    // 데몬이 띄운 세션에서는 이 변수가 설정되어 있다. 아래 "보내지 않는다" 단정이
    // 실행 환경에 좌우되지 않도록 명시적으로 비운다.
    delete process.env.AGENTTEAMS_AGENT_NAME;
    rmSync(uploadDir, { force: true, recursive: true });
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(planFile, '## TL;DR\n\n퀵 로그 등록 검증', 'utf-8');
    writeFileSync(uploadReportFile, '## Summary\n\n완료보고서 입력 검증', 'utf-8');
    axiosPostSpy = jest.spyOn(axios, 'post');
    axiosPostSpy.mockImplementation((url: string) => {
      if (url.endsWith('/plans/quick')) {
        return Promise.resolve({
          data: {
            data: {
              id: 'plan-quick-1',
              plan: { id: 'plan-quick-1', status: 'DONE' },
              completionReport: { id: 'report-quick-1', webUrl: 'http://quick-report-url' },
            },
          },
        } as any);
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    // getPlan mock
    axiosGetSpy = jest.spyOn(axios, 'get');
    axiosGetSpy.mockResolvedValue({
      data: {
        data: {
          id: 'plan-quick-1',
          startCommit: 'abcdef0123456789',
        },
      },
    } as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { force: true, recursive: true });
    if (originalAgentName === undefined) {
      delete process.env.AGENTTEAMS_AGENT_NAME;
    } else {
      process.env.AGENTTEAMS_AGENT_NAME = originalAgentName;
    }
  });

  const quickOptions = () => ({
    title: 'Quick Plan Title',
    file: planFile,
    reportFile: uploadReportFile,
    runnerType: 'CLAUDE_CODE',
    model: 'claude-opus-4-8',
    git: false,
  });

  it.each([undefined, null, '', ' \t\n', 42])('보고서 경로 누락(%p)은 요청 전에 실패한다', async (value) => {
    await expect(
      executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
        ...quickOptions(),
        reportFile: value,
      }),
    ).rejects.toThrow(/--report-file is required for plan quick.*--report-file <path>/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(existsSync(planFile)).toBe(true);
    expect(existsSync(uploadReportFile)).toBe(true);
  });

  it('계획 파일을 누락된 보고서의 대체 입력으로 사용하지 않는다', async () => {
    const { reportFile: _reportFile, ...options } = quickOptions();
    await expect(executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', options)).rejects.toThrow(
      /--report-file is required/,
    );
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(existsSync(planFile)).toBe(true);
  });

  it('없는 보고서 파일은 요청 전에 실패하고 계획 파일을 보존한다', async () => {
    const missingFile = join(uploadDir, 'missing.md');
    await expect(
      executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
        ...quickOptions(),
        reportFile: missingFile,
      }),
    ).rejects.toThrow(`File not found: ${missingFile}`);
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(existsSync(missingFile)).toBe(false);
    expect(existsSync(planFile)).toBe(true);
    expect(existsSync(uploadReportFile)).toBe(true);
  });

  it.each(['', ' \t\n'])('빈 보고서 본문(%p)은 요청 전에 실패하고 입력 파일을 보존한다', async (content) => {
    writeFileSync(uploadReportFile, content, 'utf-8');
    await expect(
      executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', quickOptions()),
    ).rejects.toThrow('Report file is empty.');
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(existsSync(planFile)).toBe(true);
    expect(readFileSync(uploadReportFile, 'utf-8')).toBe(content);
  });

  it('보고서 읽기 실패는 요청 전에 전파하고 입력 경로를 보존한다', async () => {
    // 권한 테스트는 관리자 계정에서 통과할 수 있어 디렉터리 읽기 오류로 재현한다.
    const unreadableFile = join(uploadDir, 'unreadable.md');
    mkdirSync(unreadableFile);
    await expect(
      executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
        ...quickOptions(),
        reportFile: unreadableFile,
      }),
    ).rejects.toThrow(/EISDIR/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(existsSync(planFile)).toBe(true);
    expect(existsSync(unreadableFile)).toBe(true);
    expect(existsSync(uploadReportFile)).toBe(true);
  });

  it.each([false, true])('성공 후 임시 입력 파일 보존은 keepTemp=%p를 따른다', async (keepTemp) => {
    const result = await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      ...quickOptions(),
      keepTemp,
    });
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(axiosPostSpy.mock.calls[0][1]).toMatchObject({
      content: '## TL;DR\n\n퀵 로그 등록 검증',
      completionReport: { title: 'Quick Plan Title', content: '## Summary\n\n완료보고서 입력 검증' },
    });
    expect(result.reportCreated).toBe(true);
    expect(existsSync(planFile)).toBe(keepTemp);
    expect(existsSync(uploadReportFile)).toBe(keepTemp);
  });

  it('등록 요청 실패 시 임시 입력 파일을 보존한다', async () => {
    axiosPostSpy.mockRejectedValue(new Error('Quick request failed'));
    await expect(
      executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', quickOptions()),
    ).rejects.toThrow('Quick request failed');
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(planFile)).toBe(true);
    expect(existsSync(uploadReportFile)).toBe(true);
  });

  it('선택 보고서 메타데이터와 저장소 URL을 단일 요청으로 전달한다', async () => {
    const metadata = {
      reportTitle: '  Quick Report Title  ',
      reportStatus: 'PARTIAL',
      qualityScore: 85,
      commitHash: 'head-commit',
      commitStart: 'base-commit',
      commitEnd: 'end-commit',
      branchName: 'feat/example',
      filesModified: 3,
      linesAdded: 10,
      linesDeleted: 2,
      durationSeconds: 120,
      pullRequestId: '42',
      reviewRecommendation: 'REQUIRED',
      reviewReason: '검수 필요',
      repositoryRemoteUrl: 'https://github.com/example/repo.git',
    };
    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      ...quickOptions(),
      ...metadata,
    });
    const { reportTitle, reportStatus, ...expected } = metadata;
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(axiosPostSpy.mock.calls[0][1]).toMatchObject({
      repositoryRemoteUrl: metadata.repositoryRemoteUrl,
      completionReport: {
        ...expected,
        title: reportTitle.trim(),
        status: reportStatus,
        content: '## Summary\n\n완료보고서 입력 검증',
      },
    });
  });

  it('runs plan quick with report flags and builds completionReport payload', async () => {
    const result = await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      reportFile,
      reportTitle: 'Quick Report Title',
      reportStatus: 'COMPLETED',
      qualityScore: 95,
      git: false,
    });

    // 1. Verify result structure
    expect(result.reportCreated).toBe(true);
    expect(result.reportId).toBe('report-quick-1');
    expect(result.reportWebUrl).toBe('http://quick-report-url');

    // 2. Verify quick API payload
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const quickCall = axiosPostSpy.mock.calls.find((call) => call[0].endsWith('/plans/quick'));
    expect(quickCall).toBeDefined();
    const quickBody = quickCall![1] as {
      assignedTo?: string;
      completionReport?: {
        title: string;
        content: string;
        status?: string;
        qualityScore?: number;
      };
    };
    // 지정도 없고 $AGENTTEAMS_AGENT_NAME도 없으면 보낼 에이전트가 없다. API key
    // 인증이면 서버가 agentConfigId로 추론하므로 이 경로가 정상이다.
    expect(quickBody.assignedTo).toBeUndefined();
    expect(quickBody.completionReport).toBeDefined();
    expect(quickBody.completionReport!.title).toBe('Quick Report Title');
    expect(quickBody.completionReport!.content).toContain('Did the work.');
    expect(quickBody.completionReport!.status).toBe('COMPLETED');
    expect(quickBody.completionReport!.qualityScore).toBe(95);
    expect(existsSync(reportFile)).toBe(true);
  });

  it('never forwards the retired --agent option as assignedTo', async () => {
    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      // 폐기된 입력이다. 배정은 --assigned-to 또는 $AGENTTEAMS_AGENT_NAME으로만 온다.
      agent: 'legacy-agent',
      reportFile,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
    });

    const quickCall = axiosPostSpy.mock.calls.find((call) => call[0].endsWith('/plans/quick'));
    expect(quickCall).toBeDefined();
    const quickBody = quickCall![1] as { assignedTo?: string };
    expect(quickBody.assignedTo).toBeUndefined();
  });

  it('assigns the agent the daemon exported, so authentication does not change what is recorded', async () => {
    // 데몬의 모든 러너가 세션의 agentConfigId를 이 변수로 내보낸다
    // (daemon/src/runners/*). 에이전트를 실어오지 않는 자격증명(개인 토큰)에서는
    // 이것이 유일한 귀속 근거다.
    process.env.AGENTTEAMS_AGENT_NAME = 'agent-from-daemon';

    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      reportFile,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
    });

    const quickCall = axiosPostSpy.mock.calls.find((call) => call[0].endsWith('/plans/quick'));
    expect((quickCall![1] as { assignedTo?: string }).assignedTo).toBe('agent-from-daemon');
  });

  it('lets an explicit --assigned-to win over the exported one', async () => {
    process.env.AGENTTEAMS_AGENT_NAME = 'agent-from-daemon';

    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      assignedTo: 'agent-chosen-explicitly',
      reportFile,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
    });

    const quickCall = axiosPostSpy.mock.calls.find((call) => call[0].endsWith('/plans/quick'));
    expect((quickCall![1] as { assignedTo?: string }).assignedTo).toBe('agent-chosen-explicitly');
  });

  it('does not use the just-created quick plan startCommit as the report diff range', async () => {
    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      reportFile,
      reportTitle: 'Quick Report Title',
      reportStatus: 'COMPLETED',
      qualityScore: 95,
    });

    expect(axiosGetSpy).not.toHaveBeenCalled();

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const quickCall = axiosPostSpy.mock.calls.find((call) => call[0].endsWith('/plans/quick'));
    expect(quickCall).toBeDefined();
    const quickBody = quickCall![1] as {
      completionReport?: {
        commitStart?: string;
      };
    };
    expect(quickBody.completionReport?.commitStart).not.toBe('abcdef0123456789');
  });
});
