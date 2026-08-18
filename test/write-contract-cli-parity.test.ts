import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { executeCoActionCommand } from '../src/commands/coaction.js';
import { executePostMortemCommand } from '../src/commands/postmortem.js';
import { executeCodeReviewCommand } from '../src/commands/codeReview.js';
import { handleError } from '../src/utils/errors.js';
import { mutationContractFields, writeContractFields } from '../src/utils/writeContract.js';

/**
 * MCP 쓰기 도구와 CLI는 같은 엔드포인트를 부른다. 한쪽에만 쓰기 계약 필드가 실리면
 * "MCP를 못 쓸 때 CLI로 대체해도 계약이 같다"는 플랫폼 가이드의 fallback 서술이
 * 그 엔티티에서만 거짓이 된다. 여기서는 CLI가 실제로 세 필드를 요청에 싣는지 확인한다.
 */
const apiUrl = 'http://localhost:3001';
const projectId = 'project-1';
const headers = { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' };
const headersWithoutContentType = { 'X-API-Key': 'key_test' };

const coActionsUrl = `${apiUrl}/api/projects/${projectId}/co-actions`;
const postMortemsUrl = `${apiUrl}/api/projects/${projectId}/post-mortems`;
const codeReviewsUrl = `${apiUrl}/api/projects/${projectId}/code-reviews`;

const envelope = { data: { id: 'entity-1', webUrl: 'https://agentteams.run/x' } };
const expectedUpdatedAt = '2026-08-01T00:00:00.000Z';

afterEach(() => {
  jest.restoreAllMocks();
});

const mockPost = () => jest.spyOn(axios, 'post').mockResolvedValue({ data: envelope } as never);
const mockPut = () => jest.spyOn(axios, 'put').mockResolvedValue({ data: envelope } as never);
const mockDelete = () => jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);
const mockPatch = () => jest.spyOn(axios, 'patch').mockResolvedValue({ data: envelope } as never);

describe('write contract option presence', () => {
  it.each([
    ['guideHash', writeContractFields({ guideHash: '' })],
    ['idempotencyKey', writeContractFields({ idempotencyKey: '' })],
    ['expectedUpdatedAt', mutationContractFields({ expectedUpdatedAt: '' })],
  ])('preserves an explicitly empty %s so the server rejects it', (fieldName, fields) => {
    expect(fields).toEqual({ [fieldName]: '' });
  });

  it('still omits contract fields that were not specified', () => {
    expect(mutationContractFields({})).toEqual({});
  });
});

describe('coaction write contract fields', () => {
  it('omits the fields entirely when no option is given (back-compat)', async () => {
    const postSpy = mockPost();

    await executeCoActionCommand(apiUrl, headers, 'create', {
      projectId,
      title: 'handoff',
      content: 'body',
    });

    expect(postSpy).toHaveBeenCalledWith(coActionsUrl, { title: 'handoff', content: 'body' }, { headers });
  });

  it('carries guideHash and idempotencyKey on create', async () => {
    const postSpy = mockPost();

    await executeCoActionCommand(apiUrl, headers, 'create', {
      projectId,
      title: 'handoff',
      content: 'body',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
    });

    expect(postSpy).toHaveBeenCalledWith(
      coActionsUrl,
      { title: 'handoff', content: 'body', guideHash: 'hash-123', idempotencyKey: 'key-abc' },
      { headers },
    );
  });

  it('carries all three fields on update', async () => {
    const putSpy = mockPut();

    await executeCoActionCommand(apiUrl, headers, 'update', {
      projectId,
      id: 'act-1',
      status: 'CLOSED',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });

    expect(putSpy).toHaveBeenCalledWith(
      `${coActionsUrl}/act-1`,
      { status: 'CLOSED', guideHash: 'hash-123', idempotencyKey: 'key-abc', expectedUpdatedAt },
      { headers },
    );
  });

  it('sends the delete fields as query params, and none when unset', async () => {
    const deleteSpy = mockDelete();

    await executeCoActionCommand(apiUrl, headers, 'delete', { projectId, id: 'act-1' });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${coActionsUrl}/act-1`, { headers: headersWithoutContentType });

    await executeCoActionCommand(apiUrl, headers, 'delete', {
      projectId,
      id: 'act-1',
      guideHash: 'hash-123',
      expectedUpdatedAt,
    });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${coActionsUrl}/act-1`, {
      headers: headersWithoutContentType,
      params: { guideHash: 'hash-123', expectedUpdatedAt },
    });
  });
});

describe('postmortem write contract fields', () => {
  const baseCreate = {
    projectId,
    title: 'incident',
    content: 'x'.repeat(60),
    actionItems: 'follow-up',
    // git origin 자동 탐지는 실행 위치에 따라 값이 달라지므로 끈다.
    git: false,
  };

  it('carries guideHash and idempotencyKey on create', async () => {
    const postSpy = mockPost();

    await executePostMortemCommand(apiUrl, headers, 'create', {
      ...baseCreate,
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
    });

    expect(postSpy).toHaveBeenCalledWith(
      postMortemsUrl,
      {
        title: baseCreate.title,
        content: baseCreate.content,
        actionItems: ['follow-up'],
        guideHash: 'hash-123',
        idempotencyKey: 'key-abc',
      },
      { headers },
    );
  });

  it('carries all three fields on update', async () => {
    const putSpy = mockPut();

    await executePostMortemCommand(apiUrl, headers, 'update', {
      projectId,
      id: 'pmt-1',
      status: 'RESOLVED',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });

    expect(putSpy).toHaveBeenCalledWith(
      `${postMortemsUrl}/pmt-1`,
      { status: 'RESOLVED', guideHash: 'hash-123', idempotencyKey: 'key-abc', expectedUpdatedAt },
      { headers },
    );
  });

  it('sends the delete fields as query params — the only delete path this record kind has', async () => {
    const deleteSpy = mockDelete();

    await executePostMortemCommand(apiUrl, headers, 'delete', { projectId, id: 'pmt-1' });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${postMortemsUrl}/pmt-1`, { headers: headersWithoutContentType });

    await executePostMortemCommand(apiUrl, headers, 'delete', {
      projectId,
      id: 'pmt-1',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${postMortemsUrl}/pmt-1`, {
      headers: headersWithoutContentType,
      params: { idempotencyKey: 'key-abc', expectedUpdatedAt },
    });
  });
});

describe('code-review write contract fields', () => {
  it('carries guideHash and idempotencyKey on create', async () => {
    const postSpy = mockPost();

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
      title: 'review',
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-5',
      git: false,
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
    });

    expect(postSpy).toHaveBeenCalledWith(
      codeReviewsUrl,
      {
        title: 'review',
        targetType: 'LOCAL_DIFF',
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-5',
        guideHash: 'hash-123',
        idempotencyKey: 'key-abc',
      },
      { headers },
    );
  });

  it('carries all three fields on update, but they alone are not a change', async () => {
    const patchSpy = mockPatch();

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'update', {
      id: 'rev-1',
      title: 'new title',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });

    expect(patchSpy).toHaveBeenCalledWith(
      `${codeReviewsUrl}/rev-1`,
      { title: 'new title', guideHash: 'hash-123', idempotencyKey: 'key-abc', expectedUpdatedAt },
      { headers },
    );

    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'update', { id: 'rev-1', guideHash: 'hash-123' }),
    ).rejects.toThrow(/At least one metadata field/);
  });

  it('carries guideHash and idempotencyKey on cancel', async () => {
    const postSpy = mockPost();

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'cancel', {
      id: 'rev-1',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${codeReviewsUrl}/rev-1/cancel`,
      { guideHash: 'hash-123', idempotencyKey: 'key-abc' },
      { headers },
    );
  });

  it.each(['dismiss', 'undismiss'])('carries all three fields on %s', async (action) => {
    const postSpy = mockPost();

    await executeCodeReviewCommand(apiUrl, projectId, headers, action, {
      id: 'rev-1',
      findingId: 'rvf-1',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${codeReviewsUrl}/rev-1/findings/rvf-1/${action}`,
      { guideHash: 'hash-123', idempotencyKey: 'key-abc', expectedUpdatedAt },
      { headers },
    );
  });

  it('carries all three fields on a single-finding resolve', async () => {
    const postSpy = mockPost();

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'resolve', {
      id: 'rev-1',
      findingId: 'rvf-1',
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
      expectedUpdatedAt,
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${codeReviewsUrl}/rev-1/findings/rvf-1/resolve`,
      { guideHash: 'hash-123', idempotencyKey: 'key-abc', expectedUpdatedAt },
      { headers },
    );
  });

  it('refuses to share one idempotency key across a multi-finding resolve', async () => {
    // finding마다 별개의 요청이라 두 번째부터 "같은 키 + 다른 요청"이 되어 서버가 409로 거절한다.
    // 그 409를 맞기 전에 CLI가 먼저 막아 실패 원인을 분명히 한다.
    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'resolve', {
        id: 'rev-1',
        findingIds: 'rvf-1,rvf-2',
        idempotencyKey: 'key-abc',
      }),
    ).rejects.toThrow(/--idempotency-key applies to a single finding/);
  });

  it('refuses to share one concurrency timestamp across a multi-finding resolve', async () => {
    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'resolve', {
        id: 'rev-1',
        findingIds: 'rvf-1,rvf-2',
        expectedUpdatedAt,
      }),
    ).rejects.toThrow(/--expected-updated-at applies to a single finding/);
  });

  it('still resolves several findings when no idempotency key is given', async () => {
    const postSpy = mockPost();

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'resolve', {
      id: 'rev-1',
      findingIds: 'rvf-1,rvf-2',
      guideHash: 'hash-123',
    });

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenLastCalledWith(
      `${codeReviewsUrl}/rev-1/findings/rvf-2/resolve`,
      { guideHash: 'hash-123' },
      { headers },
    );
  });
});

describe('a stale --guide-hash comes back as GUIDE_OUTDATED with the resync path', () => {
  it.each([
    ['co-action-guide.md', 'CO_ACTION_GUIDE_OUTDATED'],
    ['post-mortem-guide.md', 'POST_MORTEM_GUIDE_OUTDATED'],
    ['code-review-guide.md', 'CODE_REVIEW_GUIDE_OUTDATED'],
  ])('%s', (guideFileName, errorDetailCode) => {
    const message = handleError({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: {
          statusCode: 409,
          error: 'Conflict',
          message: 'Your local guide is outdated.',
          errorCode: 'GUIDE_OUTDATED',
          errorDetailCode,
          requiredGuideHash: 'server-hash',
          guideFileName,
        },
      },
    });

    expect(message).toContain('agentteams convention download');
    expect(message).toContain(guideFileName);
    expect(message).toContain('server-hash');
  });
});
