import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import axios from 'axios';
import { executeAttachmentCommand } from '../src/commands/attachment.js';

describe('attachment command', () => {
  const headers = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };
  const apiUrl = 'http://localhost:3001';

  let axiosGetSpy: jest.SpiedFunction<typeof axios.get>;

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosGetSpy = jest.spyOn(axios, 'get');
  });

  const writeTempFile = (name: string, content: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'attach-test-'));
    const filePath = join(dir, name);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  };

  it('list hits GET /api/daemon-triggers/:id/attachments', async () => {
    axiosGetSpy.mockResolvedValueOnce({ data: { data: [], meta: { total: 0 } } } as any);

    const result = await executeAttachmentCommand(apiUrl, headers, 'list', { triggerId: 'trig-1' });

    expect(axiosGetSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/daemon-triggers/trig-1/attachments',
      { headers }
    );
    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('list rejects when --trigger-id is missing', async () => {
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'list', {})
    ).rejects.toThrow('--trigger-id is required');
  });

  it('create uploads the file to R2 and registers it against a code review', async () => {
    const filePath = writeTempFile('evidence.txt', 'hello world!');
    const postSpy = jest.spyOn(axios, 'post');
    const putSpy = jest.spyOn(axios, 'put');

    postSpy.mockResolvedValueOnce({
      data: { data: { uploadUrl: 'https://r2.example/put?sig=1', key: 'drafts/member-1/abc-evidence.txt' } },
    } as any);
    putSpy.mockResolvedValueOnce({ status: 200 } as any);
    postSpy.mockResolvedValueOnce({ data: { data: { id: 'att-1', codeReviewId: 'rev-1' } } } as any);

    const result = await executeAttachmentCommand(apiUrl, headers, 'create', {
      file: filePath,
      codeReviewId: 'rev-1',
    });

    expect(postSpy).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/api/attachments/draft-upload-url',
      { fileName: 'evidence.txt', contentType: 'text/plain', size: 12 },
      { headers }
    );
    expect(putSpy).toHaveBeenCalledWith(
      'https://r2.example/put?sig=1',
      expect.any(Buffer),
      { headers: { 'Content-Type': 'text/plain' } }
    );
    expect(postSpy).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/api/attachments',
      {
        targetType: 'codeReview',
        targetId: 'rev-1',
        key: 'drafts/member-1/abc-evidence.txt',
        originalName: 'evidence.txt',
      },
      { headers }
    );
    expect(result).toEqual({ data: { id: 'att-1', codeReviewId: 'rev-1' } });
  });

  it('create requires exactly one target id', async () => {
    const filePath = writeTempFile('evidence.txt', 'hello');
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'create', { file: filePath })
    ).rejects.toThrow(/Exactly one of/);
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'create', {
        file: filePath,
        codeReviewId: 'rev-1',
        completionReportId: 'rpt-1',
      })
    ).rejects.toThrow(/only one/i);
  });

  it('create requires --file', async () => {
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'create', { codeReviewId: 'rev-1' })
    ).rejects.toThrow('--file is required');
  });

  it('create rejects unsupported file types', async () => {
    const filePath = writeTempFile('evidence.exe', 'binary');
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'create', { file: filePath, codeReviewId: 'rev-1' })
    ).rejects.toThrow(/Unsupported attachment type/);
  });

  it('upload is not supported (the CLI must not call removed API routes)', async () => {
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'upload', { triggerId: 'trig-1', file: '/tmp/x.txt' })
    ).rejects.toThrow(/not supported/i);
  });

  it('delete is not supported (the CLI must not call removed API routes)', async () => {
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'delete', { id: 'a-1' })
    ).rejects.toThrow(/not supported/i);
  });

  it('rejects unknown actions', async () => {
    await expect(
      executeAttachmentCommand(apiUrl, headers, 'rename', {})
    ).rejects.toThrow(/Unknown attachment action/);
  });
});
