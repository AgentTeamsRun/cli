import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executePlanCommand } from '../src/commands/plan.js';

describe('plan quick with completion report integration', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plan-quick-report-'));
  const reportFile = join(tmp, 'report.md');
  writeFileSync(reportFile, '# Report\n\n' + 'Did the work. '.repeat(10), 'utf-8');
  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;
  let axiosGetSpy: jest.SpiedFunction<typeof axios.get>;
  const originalAgentName = process.env.AGENTTEAMS_AGENT_NAME;

  beforeEach(() => {
    jest.restoreAllMocks();
    // 데몬이 띄운 세션에서는 이 변수가 설정되어 있다. 아래 "보내지 않는다" 단정이
    // 실행 환경에 좌우되지 않도록 명시적으로 비운다.
    delete process.env.AGENTTEAMS_AGENT_NAME;
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
    rmSync(tmp, { force: true, recursive: true });
    if (originalAgentName === undefined) {
      delete process.env.AGENTTEAMS_AGENT_NAME;
    } else {
      process.env.AGENTTEAMS_AGENT_NAME = originalAgentName;
    }
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
  });

  it('never forwards the retired --agent option as assignedTo', async () => {
    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      // 폐기된 입력이다. 배정은 --assigned-to 또는 $AGENTTEAMS_AGENT_NAME으로만 온다.
      agent: 'legacy-agent',
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
