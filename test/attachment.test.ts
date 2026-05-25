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
