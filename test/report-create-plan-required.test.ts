import { describe, it, expect, jest, afterEach, afterAll } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeReportCommand } from '../src/commands/report.js';

describe('report create requires a plan (no standalone reports)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'report-create-plan-'));
  const reportFile = join(tmp, 'report.md');
  writeFileSync(reportFile, '# Report\n\n' + 'Did the work. '.repeat(10), 'utf-8');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when --plan-id is missing and never calls the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');

    await expect(
      executeReportCommand('http://localhost:3001', {}, 'create', {
        projectId: 'test-project',
        title: 'Standalone Report',
        file: reportFile,
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-4-8',
        git: false,
      }),
    ).rejects.toThrow(/--plan-id is required/);

    expect(postSpy).not.toHaveBeenCalled();
  });

  it('proceeds to the API when --plan-id is provided', async () => {
    const postSpy = jest.spyOn(axios, 'post');
    postSpy.mockResolvedValue({
      data: { data: { id: 'report-1', planId: 'plan-1', webUrl: 'http://report-url' } },
    } as any);

    const result = await executeReportCommand('http://localhost:3001', {}, 'create', {
      projectId: 'test-project',
      planId: 'plan-1',
      title: 'Linked Report',
      file: reportFile,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-8',
      git: false,
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const body = postSpy.mock.calls[0][1] as { planId?: string };
    expect(body.planId).toBe('plan-1');
    expect(result.data.id).toBe('report-1');
  });

  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });
});
