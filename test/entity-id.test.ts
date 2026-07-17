import { describe, it, expect } from '@jest/globals';
import { stripEntityIdPrefix, normalizeEntityIdOptions } from '../src/utils/entityId.js';

describe('stripEntityIdPrefix', () => {
  it('strips canonical entity prefixes to the bare id', () => {
    const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
    expect(stripEntityIdPrefix(`agentteams_pln_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_rpt_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_rev_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_act_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_cnv_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_pmt_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_doc_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_rvf_${uuid}`)).toBe(uuid);
    expect(stripEntityIdPrefix(`agentteams_tsk_${uuid}`)).toBe(uuid);
  });

  it('leaves bare ids untouched', () => {
    const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
    expect(stripEntityIdPrefix(uuid)).toBe(uuid);
    expect(stripEntityIdPrefix('plan-123')).toBe('plan-123');
  });

  it('does not strip unknown prefixes', () => {
    expect(stripEntityIdPrefix('agentteams_xyz_123')).toBe('agentteams_xyz_123');
    expect(stripEntityIdPrefix('pln_123')).toBe('pln_123');
  });

  it('only strips a leading prefix, not occurrences inside the id', () => {
    expect(stripEntityIdPrefix('id-agentteams_pln_123')).toBe('id-agentteams_pln_123');
  });

  it('passes through non-string values', () => {
    expect(stripEntityIdPrefix(undefined)).toBeUndefined();
    expect(stripEntityIdPrefix(null)).toBeNull();
    expect(stripEntityIdPrefix(42)).toBe(42);
  });
});

describe('normalizeEntityIdOptions', () => {
  it('normalizes id-bearing option keys', () => {
    const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
    const result = normalizeEntityIdOptions({
      id: `agentteams_pln_${uuid}`,
      planId: `agentteams_pln_${uuid}`,
      completionReportId: `agentteams_rpt_${uuid}`,
      postMortemId: `agentteams_pmt_${uuid}`,
      coActionId: `agentteams_act_${uuid}`,
    });

    expect(result.id).toBe(uuid);
    expect(result.planId).toBe(uuid);
    expect(result.completionReportId).toBe(uuid);
    expect(result.postMortemId).toBe(uuid);
    expect(result.coActionId).toBe(uuid);
  });

  it('normalizes code-review and source id flags pasted from web references', () => {
    const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
    const result = normalizeEntityIdOptions({
      codeReviewId: `agentteams_rev_${uuid}`,
      sourcePlanId: `agentteams_pln_${uuid}`,
      sourceCompletionReportId: `agentteams_rpt_${uuid}`,
    });

    expect(result.codeReviewId).toBe(uuid);
    expect(result.sourcePlanId).toBe(uuid);
    expect(result.sourceCompletionReportId).toBe(uuid);
  });

  it('normalizes finding and task id flags for focused sub-entity fetches', () => {
    const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
    const result = normalizeEntityIdOptions({
      findingId: `agentteams_rvf_${uuid}`,
      taskId: `agentteams_tsk_${uuid}`,
    });

    expect(result.findingId).toBe(uuid);
    expect(result.taskId).toBe(uuid);
  });

  it('leaves non-AgentTeams id flags untouched', () => {
    const result = normalizeEntityIdOptions({
      projectId: 'agentteams_proj_keep',
      teamId: 'team-123',
      issueId: 'owner/repo#42',
    });

    expect(result.projectId).toBe('agentteams_proj_keep');
    expect(result.teamId).toBe('team-123');
    expect(result.issueId).toBe('owner/repo#42');
  });

  it('does not touch non-id options even if they look prefixed', () => {
    const result = normalizeEntityIdOptions({
      id: 'agentteams_pln_abc',
      title: 'agentteams_pln_should_stay',
      content: 'agentteams_doc_keepme',
    });

    expect(result.id).toBe('abc');
    expect(result.title).toBe('agentteams_pln_should_stay');
    expect(result.content).toBe('agentteams_doc_keepme');
  });

  it('returns the original object when nothing changed', () => {
    const options = { id: 'plan-1', status: 'IN_PROGRESS' };
    expect(normalizeEntityIdOptions(options)).toBe(options);
  });
});
