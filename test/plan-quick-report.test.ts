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

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosPostSpy = jest.spyOn(axios, 'post');
    // createPlan, startPlanLifecycle, finishPlanLifecycle
    axiosPostSpy.mockImplementation((url: string) => {
      if (url.endsWith('/plans')) {
        return Promise.resolve({ data: { data: { id: 'plan-quick-1', status: 'BACKLOG' } } } as any);
      }
      if (url.includes('/start')) {
        return Promise.resolve({ data: { data: { id: 'plan-quick-1', status: 'IN_PROGRESS' } } } as any);
      }
      if (url.includes('/finish')) {
        return Promise.resolve({
          data: {
            data: {
              id: 'plan-quick-1',
              status: 'DONE',
              completionReport: { id: 'report-quick-1', webUrl: 'http://quick-report-url' },
            },
          },
        } as any);
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    // getPlan mock
    const axiosGetSpy = jest.spyOn(axios, 'get');
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

    // 2. Verify finish API payload
    const finishCall = axiosPostSpy.mock.calls.find((call) => call[0].includes('/finish'));
    expect(finishCall).toBeDefined();
    const finishBody = finishCall![1] as {
      completionReport?: {
        title: string;
        content: string;
        status?: string;
        qualityScore?: number;
      };
    };
    expect(finishBody.completionReport).toBeDefined();
    expect(finishBody.completionReport!.title).toBe('Quick Report Title');
    expect(finishBody.completionReport!.content).toContain('Did the work.');
    expect(finishBody.completionReport!.status).toBe('COMPLETED');
    expect(finishBody.completionReport!.qualityScore).toBe(95);
  });
});
