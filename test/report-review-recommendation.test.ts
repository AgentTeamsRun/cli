import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeReportCommand } from '../src/commands/report.js';

// report create의 --review-recommendation/--review-reason 매핑과
// update 이후 리뷰 권고 변경이 전용 경로로 안내되는지 검증한다.
describe('report review recommendation commands', () => {
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

  it('rejects a review-only update without sending an empty PUT', async () => {
    await expect(
      executeReportCommand('http://localhost:3001', {}, 'update', {
        projectId: 'test-project',
        id: 'report-1',
        reviewRecommendation: 'NOT_NEEDED',
      }),
    ).rejects.toThrow('agentteams report dismiss-review');

    expect(putSpy).not.toHaveBeenCalled();
  });

  it('drops NOT_NEEDED from a mixed update and points to dismiss-review', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await executeReportCommand('http://localhost:3001', {}, 'update', {
      projectId: 'test-project',
      id: 'report-1',
      title: 'Updated title',
      reviewRecommendation: 'NOT_NEEDED',
      reviewReason: '문구 오타 수정',
    });
    const body = putSpy.mock.calls[0][1] as { reviewRecommendation?: string; reviewReason?: string };
    expect(body.reviewRecommendation).toBeUndefined();
    expect(body.reviewReason).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentteams report dismiss-review'));
  });

  it('does not point REQUIRED updates to dismiss-review', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await executeReportCommand('http://localhost:3001', {}, 'update', {
      projectId: 'test-project',
      id: 'report-1',
      title: 'Updated title',
      reviewRecommendation: 'REQUIRED',
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentteams code-review create'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('dismiss-review'));
  });

  it('dismisses a report review through the dedicated endpoint', async () => {
    await executeReportCommand('http://localhost:3001', {}, 'dismiss-review', {
      projectId: 'test-project',
      id: 'report-1',
    });

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/projects/test-project/completion-reports/report-1/dismiss-review',
      {},
      { headers: {} },
    );
  });

  it('requires an id to dismiss a report review', async () => {
    await expect(
      executeReportCommand('http://localhost:3001', {}, 'dismiss-review', {
        projectId: 'test-project',
      }),
    ).rejects.toThrow('--id is required for report dismiss-review');
  });

  it.each([
    [
      409,
      'COMPLETION_REPORT_REVIEW_ALREADY_LINKED',
      'An active (non-cancelled) code review is already linked, so the report review cannot be dismissed.',
    ],
    [404, 'COMPLETION_REPORT_NOT_FOUND', 'Completion report not found: report-1'],
  ])(
    'returns a readable message for the known dismiss-review HTTP %s error',
    async (status, errorDetailCode, message) => {
      postSpy.mockRejectedValueOnce(
        Object.assign(new Error(`Request failed with status code ${status}`), {
          isAxiosError: true,
          response: {
            status,
            data: { errorDetailCode, message: `localized server message for ${errorDetailCode}` },
          },
        }) as never,
      );

      await expect(
        executeReportCommand('http://localhost:3001', {}, 'dismiss-review', {
          projectId: 'test-project',
          id: 'report-1',
        }),
      ).rejects.toThrow(`${message}\nDetails: localized server message for ${errorDetailCode}`);
    },
  );

  it.each([409, 404])('preserves an unrecognized dismiss-review HTTP %s error', async (status) => {
    const originalError = Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status, data: { message: 'legacy or proxy response' } },
    });
    postSpy.mockRejectedValueOnce(originalError as never);

    await expect(
      executeReportCommand('http://localhost:3001', {}, 'dismiss-review', {
        projectId: 'test-project',
        id: 'report-1',
      }),
    ).rejects.toBe(originalError);
  });
});
