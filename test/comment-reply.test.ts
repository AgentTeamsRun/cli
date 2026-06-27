import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import axios from 'axios';
import { executeCommentCommand } from '../src/commands/comment.js';

const API = 'http://localhost:3001';
const PROJECT = 'project_1';
const HEADERS = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };

describe('comment reply commands', () => {
  let getSpy: jest.SpiedFunction<typeof axios.get>;
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let putSpy: jest.SpiedFunction<typeof axios.put>;
  let deleteSpy: jest.SpiedFunction<typeof axios.delete>;

  beforeEach(() => {
    jest.restoreAllMocks();
    getSpy = jest.spyOn(axios, 'get');
    postSpy = jest.spyOn(axios, 'post');
    putSpy = jest.spyOn(axios, 'put');
    deleteSpy = jest.spyOn(axios, 'delete');
  });

  it('reply-create POSTs to the parent comment replies endpoint', async () => {
    postSpy.mockResolvedValueOnce({ data: { data: { id: 'reply_1', content: 'ok' } } } as any);

    const result = await executeCommentCommand(API, PROJECT, HEADERS, 'reply-create', {
      id: 'comment_1',
      content: '확인했습니다',
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${API}/api/projects/${PROJECT}/comments/comment_1/replies`,
      { content: '확인했습니다' },
      expect.objectContaining({ headers: HEADERS }),
    );
    expect(result).toEqual({ data: { id: 'reply_1', content: 'ok' } });
  });

  it('reply-list GETs the parent comment replies endpoint', async () => {
    getSpy.mockResolvedValueOnce({ data: { data: [], meta: { total: 0 } } } as any);

    await executeCommentCommand(API, PROJECT, HEADERS, 'reply-list', { id: 'comment_1' });

    expect(getSpy).toHaveBeenCalledWith(
      `${API}/api/projects/${PROJECT}/comments/comment_1/replies`,
      expect.objectContaining({ headers: HEADERS }),
    );
  });

  it('reply-update PUTs to the comment-replies endpoint', async () => {
    putSpy.mockResolvedValueOnce({ data: { data: { id: 'reply_1', content: 'edited' } } } as any);

    await executeCommentCommand(API, PROJECT, HEADERS, 'reply-update', {
      replyId: 'reply_1',
      content: 'edited',
    });

    expect(putSpy).toHaveBeenCalledWith(
      `${API}/api/projects/${PROJECT}/comment-replies/reply_1`,
      { content: 'edited' },
      expect.objectContaining({ headers: HEADERS }),
    );
  });

  it('reply-delete DELETEs the comment-replies endpoint and returns a message', async () => {
    deleteSpy.mockResolvedValueOnce({ data: null } as any);

    const result = await executeCommentCommand(API, PROJECT, HEADERS, 'reply-delete', {
      replyId: 'reply_1',
    });

    expect(deleteSpy).toHaveBeenCalledWith(`${API}/api/projects/${PROJECT}/comment-replies/reply_1`, expect.anything());
    expect(result).toEqual({ message: 'Reply reply_1 deleted successfully' });
  });

  it('validates required options', async () => {
    await expect(executeCommentCommand(API, PROJECT, HEADERS, 'reply-create', { content: 'x' })).rejects.toThrow(
      '--id is required',
    );
    await expect(executeCommentCommand(API, PROJECT, HEADERS, 'reply-create', { id: 'c1' })).rejects.toThrow(
      '--content is required',
    );
    await expect(executeCommentCommand(API, PROJECT, HEADERS, 'reply-update', { content: 'x' })).rejects.toThrow(
      '--reply-id is required',
    );
    await expect(executeCommentCommand(API, PROJECT, HEADERS, 'reply-delete', {})).rejects.toThrow(
      '--reply-id is required',
    );
  });
});
