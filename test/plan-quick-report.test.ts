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

  beforeEach(() => {
    jest.restoreAllMocks();
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
  });

  it('runs plan quick with report flags and builds completionReport payload', async () => {
    const result = await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      agent: 'test-agent',
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
    expect(quickBody.assignedTo).toBe('test-agent');
    expect(quickBody.completionReport).toBeDefined();
    expect(quickBody.completionReport!.title).toBe('Quick Report Title');
    expect(quickBody.completionReport!.content).toContain('Did the work.');
    expect(quickBody.completionReport!.status).toBe('COMPLETED');
    expect(quickBody.completionReport!.qualityScore).toBe(95);
  });

  it('does not use the just-created quick plan startCommit as the report diff range', async () => {
    await executePlanCommand('http://localhost:3001', 'test-project', {}, 'quick', {
      title: 'Quick Plan Title',
      content: 'Quick plan description',
      agent: 'test-agent',
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
