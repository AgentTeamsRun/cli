import { describe, it, expect } from '@jest/globals';
import { parseEntityRef } from '../src/utils/entityRef.js';

const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
const otherUuid = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

describe('parseEntityRef', () => {
  it('parses a reference token and strips the entity id prefix', () => {
    expect(parseEntityRef(`plan:agentteams_pln_${uuid}`)).toMatchObject({
      refType: 'plan',
      id: uuid,
      kind: 'file',
      external: false,
    });
  });

  it('infers the type from a bare prefixed id', () => {
    expect(parseEntityRef(`agentteams_doc_${uuid}`)).toMatchObject({
      refType: 'document',
      id: uuid,
      kind: 'file',
    });
    expect(parseEntityRef(`agentteams_rev_${uuid}`)).toMatchObject({ refType: 'codeReview', kind: 'record' });
    expect(parseEntityRef(`agentteams_tsk_${uuid}`)).toMatchObject({ refType: 'planTask', kind: 'record' });
  });

  it('maps every body-bearing type to a downloadable file', () => {
    for (const refType of ['plan', 'completionReport', 'postMortem', 'coAction', 'document']) {
      expect(parseEntityRef(`${refType}:${uuid}`)).toMatchObject({ refType, kind: 'file' });
    }
  });

  it('reads a convention reference as a local path', () => {
    expect(parseEntityRef(`convention:${uuid}:.agentteams/rules/context.md`)).toMatchObject({
      refType: 'convention',
      id: uuid,
      kind: 'localFile',
      path: '.agentteams/rules/context.md',
    });
  });

  it('falls back to a server record for a convention reference without a path', () => {
    expect(parseEntityRef(`convention:${uuid}`)).toMatchObject({
      refType: 'convention',
      kind: 'record',
    });
    expect(parseEntityRef(`convention:${uuid}`).path).toBeUndefined();
  });

  it('promotes a three-part code review reference to a finding, keeping the parent id', () => {
    expect(parseEntityRef(`codeReview:agentteams_rev_${uuid}:agentteams_rvf_${otherUuid}`)).toMatchObject({
      refType: 'codeReviewFinding',
      id: otherUuid,
      parentId: uuid,
      kind: 'record',
    });
  });

  it('promotes a three-part plan reference to a plan task, keeping the parent id', () => {
    expect(parseEntityRef(`plan:${uuid}:agentteams_tsk_${otherUuid}`)).toMatchObject({
      refType: 'planTask',
      id: otherUuid,
      parentId: uuid,
      kind: 'record',
    });
  });

  it('rejects three-part references for types that do not have a child', () => {
    expect(() => parseEntityRef(`document:${uuid}:${otherUuid}`)).toThrow(/three-part references are not supported/);
  });

  it('extracts the target out of a whole markdown link, including the entity-ref sentinel URL', () => {
    expect(parseEntityRef(`[Safari pull-to-refresh](plan:agentteams_pln_${uuid})`)).toMatchObject({
      refType: 'plan',
      id: uuid,
      label: 'Safari pull-to-refresh',
    });

    expect(parseEntityRef(`[Issue](https://__entity_ref__/LINEAR_ISSUE%3A${uuid})`)).toMatchObject({
      refType: 'LINEAR_ISSUE',
      id: uuid,
      kind: 'record',
      external: true,
      label: 'Issue',
    });
  });

  it('keeps external locators verbatim instead of stripping an entity prefix', () => {
    expect(parseEntityRef('LINEAR_ISSUE:agentteams_pln_keep-me')).toMatchObject({
      refType: 'LINEAR_ISSUE',
      id: 'agentteams_pln_keep-me',
      fallbackCommand: 'agentteams linear issue get --issue-id agentteams_pln_keep-me',
    });
  });

  it('turns a GitHub reference into a url and a gh command without any lookup', () => {
    expect(parseEntityRef('GITHUB_ISSUE:owner/repo#12')).toMatchObject({
      refType: 'GITHUB_ISSUE',
      id: 'owner/repo#12',
      kind: 'external',
      external: true,
      url: 'https://github.com/owner/repo/issues/12',
      suggestedCommand: 'gh issue view 12 --repo owner/repo',
    });

    expect(parseEntityRef('GITHUB_PR:owner/repo#34')).toMatchObject({
      url: 'https://github.com/owner/repo/pull/34',
      suggestedCommand: 'gh pr view 34 --repo owner/repo',
    });
  });

  it('suggests glab for GitLab references but derives no url (the host can be self-managed)', () => {
    const issue = parseEntityRef('GITLAB_ISSUE:group/sub/project#7');
    expect(issue).toMatchObject({
      refType: 'GITLAB_ISSUE',
      kind: 'external',
      suggestedCommand: 'glab issue view 7 --repo group/sub/project',
    });
    expect(issue.url).toBeUndefined();

    expect(parseEntityRef('GITLAB_MERGE_REQUEST:group/project!9')).toMatchObject({
      suggestedCommand: 'glab mr view 9 --repo group/project',
    });
  });

  it('derives Bitbucket urls', () => {
    expect(parseEntityRef('BITBUCKET_ISSUE:workspace/repo#5')).toMatchObject({
      kind: 'external',
      url: 'https://bitbucket.org/workspace/repo/issues/5',
    });
    expect(parseEntityRef('BITBUCKET_PR:workspace/repo#6')).toMatchObject({
      url: 'https://bitbucket.org/workspace/repo/pull-requests/6',
    });
  });

  // A parsed id is interpolated into an API path, and references come from
  // user-authored text, so a non-UUID id must never survive parsing.
  it('rejects a non-UUID AgentTeams id instead of letting it reach an API path', () => {
    expect(() => parseEntityRef(`plan:${uuid}:../../../../auth/me`)).toThrow(/not a valid planTask id/);
    expect(() => parseEntityRef(`codeReview:${uuid}:../../../../auth/me`)).toThrow(/not a valid codeReviewFinding id/);
    expect(() => parseEntityRef('plan:../../secret')).toThrow(/not a valid plan id/);
    expect(() => parseEntityRef(`agentteams_pln_../../secret`)).toThrow(/not a valid plan id/);
    expect(() => parseEntityRef(`codeReview:not-a-uuid:${otherUuid}`)).toThrow(/not a valid parent id/);
  });

  it('leaves external locators unvalidated — they are not AgentTeams ids', () => {
    expect(parseEntityRef('GITHUB_ISSUE:owner/repo#12').id).toBe('owner/repo#12');
    expect(parseEntityRef('LINEAR_ISSUE:not-a-uuid').id).toBe('not-a-uuid');
  });

  it('reports the supported forms when the reference cannot be identified', () => {
    expect(() => parseEntityRef('not-a-reference')).toThrow(/Supported forms/);
    expect(() => parseEntityRef(`unknownType:${uuid}`)).toThrow(/unknown reference type/);
    expect(() => parseEntityRef('plan:')).toThrow(/no id/);
    expect(() => parseEntityRef('')).toThrow(/Supported forms/);
    expect(() => parseEntityRef('https://github.com/owner/repo/issues/12')).toThrow(/open the URL directly/);
  });

  it('carries the equivalent legacy command for every resolvable type', () => {
    expect(parseEntityRef(`completionReport:${uuid}`).fallbackCommand).toBe(`agentteams report download --id ${uuid}`);
    expect(parseEntityRef(`postMortem:${uuid}`).fallbackCommand).toBe(`agentteams postmortem download --id ${uuid}`);
    expect(parseEntityRef(`coAction:${uuid}`).fallbackCommand).toBe(`agentteams coaction download --id ${uuid}`);
    expect(parseEntityRef(`codeReview:${uuid}:${otherUuid}`).fallbackCommand).toBe(
      `agentteams code-review get --finding-id ${otherUuid}`,
    );
    expect(parseEntityRef(`plan:${uuid}:${otherUuid}`).fallbackCommand).toBe(
      `agentteams task get --task-id ${otherUuid}`,
    );
  });
});
