import { describe, it, expect } from '@jest/globals';
import { buildQuickPlanResult } from '../src/commands/plan.js';

// 기본 출력 포맷이 json이므로, quick 플랜 결과 JSON 최상위에 최종 상태(DONE)와
// 다음 단계가 드러나야 한다. (status가 finish.data에 깊이 묻혀 보이지 않던 문제)
describe('buildQuickPlanResult', () => {
  const finishResult = { data: { id: 'plan-1', status: 'DONE' } };
  const createResult = { data: { id: 'plan-1', status: 'BACKLOG' } };

  it('surfaces the final plan status at the top level of the JSON output', () => {
    const result = buildQuickPlanResult('plan-1', createResult, finishResult);
    expect(result.status).toBe('DONE');
    expect(result.planId).toBe('plan-1');
  });

  it('points the next step to report create (not plan finish)', () => {
    const result = buildQuickPlanResult('plan-1', createResult, finishResult);
    expect(result.next).toBe('agentteams report create --plan-id plan-1');
  });

  it('keeps the full create/finish payloads for consumers that need them', () => {
    const result = buildQuickPlanResult('plan-1', createResult, finishResult);
    expect(result.create).toBe(createResult);
    expect(result.finish).toBe(finishResult);
  });

  it('omits status gracefully when the finish payload has none', () => {
    const result = buildQuickPlanResult('plan-1', createResult, { data: { id: 'plan-1' } });
    expect('status' in result).toBe(false);
    // next 힌트는 status 유무와 무관하게 항상 제공한다.
    expect(result.next).toBe('agentteams report create --plan-id plan-1');
  });

  it('surfaces completion report information and sets reportCreated to true when completionReport is returned', () => {
    const result = buildQuickPlanResult('plan-1', createResult, {
      data: { id: 'plan-1', status: 'DONE', completionReport: { id: 'r-1', webUrl: 'http://report-url' } },
    });
    expect(result.reportCreated).toBe(true);
    expect(result.reportId).toBe('r-1');
    expect(result.reportWebUrl).toBe('http://report-url');
    expect('next' in result).toBe(false);
  });
});
