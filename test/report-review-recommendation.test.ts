import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeReportCommand } from '../src/commands/report.js';

// report create/update의 --review-recommendation/--review-reason가 서버 body로 매핑되는지,
// 잘못된 recommendation은 경고 후 누락되는지 검증한다.
// (create=POST, update=PUT를 각각 axios 스파이로 가로챈다.)
describe('report create/update review recommendation mapping', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'report-review-'));
  const reportFile = join(tmp, 'report.md');
  writeFileSync(reportFile, '# Report\n\n' + 'Did the work. '.repeat(10), 'utf-8');
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let putSpy: jest.SpiedFunction<typeof axios.put>;

  beforeEach(() => {
    jest.restoreAllMocks();
    postSpy = jest.spyOn(axios, 'post');
    postSpy.mockResolvedValue({ data: { data: { id: 'report-1', webUrl: 'http://report-url' } } } as never);
    putSpy = jest.spyOn(axios, 'put');
    putSpy.mockResolvedValue({ data: { data: { id: 'report-1', webUrl: 'http://report-url' } } } as never);
  });

  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  const create = (extra: Record<string, unknown>) =>
    executeReportCommand('http://localhost:3001', {}, 'create', {
      projectId: 'test-project',
      planId: 'plan-1',
      title: 'Linked Report',
      file: reportFile,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
      ...extra,
    });

  it('maps a valid recommendation and reason into the create body', async () => {
    await create({ reviewRecommendation: 'REQUIRED', reviewReason: 'auth 미들웨어 변경' });
    const body = postSpy.mock.calls[0][1] as { reviewRecommendation?: string; reviewReason?: string };
    expect(body.reviewRecommendation).toBe('REQUIRED');
    expect(body.reviewReason).toBe('auth 미들웨어 변경');
  });

  it('drops an invalid recommendation and warns (create)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await create({ reviewRecommendation: 'MAYBE' });
    const body = postSpy.mock.calls[0][1] as { reviewRecommendation?: string };
    expect(body.reviewRecommendation).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('maps a valid recommendation and reason into the update body', async () => {
    await executeReportCommand('http://localhost:3001', {}, 'update', {
      projectId: 'test-project',
      id: 'report-1',
      reviewRecommendation: 'NOT_NEEDED',
      reviewReason: '문구 오타 수정',
    });
    const body = putSpy.mock.calls[0][1] as { reviewRecommendation?: string; reviewReason?: string };
    expect(body.reviewRecommendation).toBe('NOT_NEEDED');
    expect(body.reviewReason).toBe('문구 오타 수정');
  });
});
