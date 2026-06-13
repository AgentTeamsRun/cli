import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executePlanCommand } from '../src/commands/plan.js';

// plan finish의 --review-recommendation/--review-reason가 완료보고서 body로 매핑되는지,
// 잘못된 recommendation은 경고 후 누락되는지 검증한다. (서버 POST는 axios.post를 스파이로 가로챔)
describe('plan finish review recommendation mapping', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plan-finish-review-'));
  const reportFile = join(tmp, 'report.md');
  writeFileSync(reportFile, '# Report\n\n' + 'Did the work. '.repeat(10), 'utf-8');
  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosPostSpy = jest.spyOn(axios, 'post');
    axiosPostSpy.mockResolvedValue({ data: { data: { id: 'plan-1', completionReport: { id: 'r1' } } } } as never);
  });

  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  const finish = (extra: Record<string, unknown>) =>
    executePlanCommand('http://localhost:3001', 'test-project', {}, 'finish', {
      id: 'plan-1',
      reportFile,
      reportTitle: 'done',
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
      ...extra,
    });

  it('maps a valid recommendation and reason into the finish body', async () => {
    await finish({ reviewRecommendation: 'REQUIRED', reviewReason: 'auth 미들웨어 변경' });
    const body = axiosPostSpy.mock.calls[0][1] as {
      completionReport: { reviewRecommendation?: string; reviewReason?: string };
    };
    expect(body.completionReport.reviewRecommendation).toBe('REQUIRED');
    expect(body.completionReport.reviewReason).toBe('auth 미들웨어 변경');
  });

  it('drops an invalid recommendation and warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await finish({ reviewRecommendation: 'MAYBE' });
    const body = axiosPostSpy.mock.calls[0][1] as { completionReport: { reviewRecommendation?: string } };
    expect(body.completionReport.reviewRecommendation).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
