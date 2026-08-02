import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { executeCommentCommand } from '../src/commands/comment.js';
import { executeDocumentCommand } from '../src/commands/document.js';
import { handleError } from '../src/utils/errors.js';

const apiUrl = 'http://localhost:3001';
const projectId = 'project-1';
const headers = { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' };
const commentsUrl = `${apiUrl}/api/projects/${projectId}/comments`;

const commentEnvelope = { data: { id: 'comment-1', content: '본문', updatedAt: '2026-08-02T00:00:00.000Z' } };
const replyEnvelope = { data: { id: 'reply-1', parentId: 'comment-1', content: '답글' } };

describe('comment write contract fields', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 계약 필드를 하나도 주지 않은 요청은 예전과 바이트 단위로 같아야 한다.
  // 여기가 무너지면 이 단계가 기존 CLI 사용자 전부에게 breaking change가 된다.
  it('sends the exact same request as before when no contract option is given', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: commentEnvelope } as never);
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: commentEnvelope } as never);
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    await executeCommentCommand(apiUrl, projectId, headers, 'create', {
      planId: 'plan-1',
      type: 'GENERAL',
      content: '본문',
    });
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/comments`,
      { type: 'GENERAL', content: '본문' },
      expect.objectContaining({ headers }),
    );

    await executeCommentCommand(apiUrl, projectId, headers, 'update', { id: 'comment-1', content: '수정' });
    expect(putSpy).toHaveBeenCalledWith(
      `${commentsUrl}/comment-1`,
      { content: '수정' },
      expect.objectContaining({ headers }),
    );

    await executeCommentCommand(apiUrl, projectId, headers, 'delete', { id: 'comment-1' });
    expect(deleteSpy.mock.calls[0]?.[1]).not.toHaveProperty('params');
  });

  it('carries guideHash and idempotencyKey on every root comment target', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: commentEnvelope } as never);

    const contract = { guideHash: 'hash-1', idempotencyKey: 'key-1' };

    await executeCommentCommand(apiUrl, projectId, headers, 'create', {
      planId: 'plan-1',
      type: 'RISK',
      content: '플랜',
      ...contract,
    });
    await executeCommentCommand(apiUrl, projectId, headers, 'create', {
      taskId: 'task-1',
      content: '태스크',
      ...contract,
    });
    await executeCommentCommand(apiUrl, projectId, headers, 'create', {
      findingId: 'finding-1',
      content: '파인딩',
      ...contract,
    });

    expect(postSpy.mock.calls[0]?.[1]).toEqual({ type: 'RISK', content: '플랜', ...contract });
    expect(postSpy.mock.calls[1]?.[1]).toEqual({ content: '태스크', ...contract });
    expect(postSpy.mock.calls[2]?.[1]).toEqual({ content: '파인딩', ...contract });
  });

  it('carries expectedUpdatedAt on update (body) and delete (query)', async () => {
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: commentEnvelope } as never);
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    await executeCommentCommand(apiUrl, projectId, headers, 'update', {
      id: 'comment-1',
      content: '수정',
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(putSpy.mock.calls[0]?.[1]).toEqual({
      content: '수정',
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });

    await executeCommentCommand(apiUrl, projectId, headers, 'delete', {
      id: 'comment-1',
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
    // DELETE 는 본문이 없으므로 쿼리로 실린다.
    expect((deleteSpy.mock.calls[0]?.[1] as { params?: unknown })?.params).toEqual({
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('carries the contract through every reply mutation and adds reply-get', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: replyEnvelope } as never);
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: replyEnvelope } as never);
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: replyEnvelope } as never);
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    const result = await executeCommentCommand(apiUrl, projectId, headers, 'reply-get', { replyId: 'reply-1' });
    expect(getSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/comment-replies/reply-1`,
      expect.objectContaining({ headers }),
    );
    expect(result).toEqual(replyEnvelope);

    await executeCommentCommand(apiUrl, projectId, headers, 'reply-create', {
      id: 'comment-1',
      content: '답글',
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
    });
    expect(postSpy.mock.calls[0]?.[1]).toEqual({ content: '답글', guideHash: 'hash-1', idempotencyKey: 'key-1' });

    await executeCommentCommand(apiUrl, projectId, headers, 'reply-update', {
      replyId: 'reply-1',
      content: '수정',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(putSpy.mock.calls[0]?.[1]).toEqual({
      content: '수정',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });

    await executeCommentCommand(apiUrl, projectId, headers, 'reply-delete', {
      replyId: 'reply-1',
      idempotencyKey: 'key-1',
    });
    expect((deleteSpy.mock.calls[0]?.[1] as { params?: unknown })?.params).toEqual({ idempotencyKey: 'key-1' });
  });

  it('reply-get requires --reply-id', async () => {
    await expect(executeCommentCommand(apiUrl, projectId, headers, 'reply-get', {})).rejects.toThrow(
      '--reply-id is required for comment reply-get',
    );
  });

  // 문서 코멘트는 중첩 라우트를 쓰지만 같은 Comment 레코드다. 계약이 갈리면 같은 엔티티가
  // 어느 문으로 들어가느냐에 따라 다르게 보호된다.
  it('carries the contract through document comment commands', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: commentEnvelope } as never);
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: commentEnvelope } as never);
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);
    const documentCommentsUrl = `${apiUrl}/api/projects/${projectId}/documents/doc-1/comments`;

    await executeDocumentCommand(apiUrl, projectId, headers, 'comment-create', {
      id: 'doc-1',
      content: '문서 코멘트',
      guideHash: 'hash-1',
      idempotencyKey: 'key-1',
    });
    expect(postSpy).toHaveBeenCalledWith(
      documentCommentsUrl,
      { content: '문서 코멘트', guideHash: 'hash-1', idempotencyKey: 'key-1' },
      expect.objectContaining({ headers }),
    );

    await executeDocumentCommand(apiUrl, projectId, headers, 'comment-update', {
      id: 'doc-1',
      commentId: 'comment-1',
      content: '수정',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(putSpy.mock.calls[0]?.[1]).toEqual({
      content: '수정',
      expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    });

    await executeDocumentCommand(apiUrl, projectId, headers, 'comment-delete', {
      id: 'doc-1',
      commentId: 'comment-1',
      idempotencyKey: 'key-1',
    });
    expect(deleteSpy.mock.calls[0]?.[0]).toBe(`${documentCommentsUrl}/comment-1`);
    expect((deleteSpy.mock.calls[0]?.[1] as { params?: unknown })?.params).toEqual({ idempotencyKey: 'key-1' });
  });

  // 서버가 돌려준 복구 정보(어떤 가이드를, 어떤 해시로)가 호출자에게 그대로 도달해야 한다.
  it('preserves GUIDE_OUTDATED and idempotency conflicts in the CLI error message', () => {
    const guideOutdated = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          errorCode: 'GUIDE_OUTDATED',
          message: 'Platform guide is outdated',
          guideFileName: 'comment-guide.md',
          requiredGuideHash: 'a'.repeat(64),
        },
      },
    };
    const message = handleError(guideOutdated);
    expect(message).toContain('comment-guide.md');
    expect(message).toContain('a'.repeat(64));
    expect(message).toContain('agentteams convention download');

    const keyReused = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { errorCode: 'CONFLICT', errorDetailCode: 'MUTATION_IDEMPOTENCY_KEY_REUSED', message: 'reused' },
      },
    };
    expect(handleError(keyReused)).toContain('idempotency key reused');

    const stale = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          errorCode: 'OPTIMISTIC_LOCK_CONFLICT',
          errorDetailCode: 'COMMENT_UPDATE_CONFLICT',
          message: 'Comment was updated by someone else',
        },
      },
    };
    expect(handleError(stale)).toContain('Conflict');
  });
});
