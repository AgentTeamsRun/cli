import { describe, it, expect, afterAll } from '@jest/globals';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executePlanCommand } from '../src/commands/plan.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};

// 완료보고서가 첨부된 finish는 runnerType/model 스냅샷을 보고서에 저장하므로,
// CLI가 두 값을 강제해 DB에 null이 남지 않도록 보장한다.
describe('plan finish runner/model snapshot enforcement', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plan-finish-'));
  const reportFile = join(tmp, 'report.md');
  writeFileSync(reportFile, '# Report\n\nDid the work.', 'utf-8');

  afterAll(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  it('rejects finish with a completion report when --runner-type is missing', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'finish', {
        id: 'plan-1',
        reportFile,
        reportTitle: 'done',
        model: 'claude-opus-4-8',
        git: false,
      }),
    ).rejects.toThrow(/--runner-type and --model are required when attaching a completion report/);
  });

  it('rejects finish with a completion report when --model is missing', async () => {
    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'finish', {
        id: 'plan-1',
        reportFile,
        reportTitle: 'done',
        runnerType: 'CLAUDE_CODE',
        git: false,
      }),
    ).rejects.toThrow(/--runner-type and --model are required when attaching a completion report/);
  });
});
