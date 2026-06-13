import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import axios, { AxiosError } from 'axios';
import { executeCoActionCommand } from '../src/commands/coaction.js';

describe('coaction command', () => {
  let axiosGetSpy: jest.SpiedFunction<typeof axios.get>;
  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosGetSpy = jest.spyOn(axios, 'get');
    axiosPostSpy = jest.spyOn(axios, 'post');
  });

  it('returns a daily quota message when coaction create hits QUOTA_EXCEEDED', async () => {
    axiosPostSpy.mockRejectedValueOnce(
      new AxiosError('quota exceeded', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: { headers: {} } as any,
        data: {
          errorCode: 'QUOTA_EXCEEDED',
          message: 'CO_ACTION_QUOTA_EXCEEDED',
        },
      }),
    );
    axiosGetSpy.mockResolvedValueOnce({
      data: {
        data: {
          coAction: {
            daily: { used: 5, limit: 5 },
            monthly: { used: 20, limit: 100 },
          },
        },
      },
    } as any);

    const result = await executeCoActionCommand(
      'http://localhost:3001',
      { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' },
      'create',
      {
        projectId: 'project_1',
        title: 'Quota test',
        content: 'body',
      },
    );

    expect(result).toBe('Daily limit reached: 5/5 used. Resets tomorrow (UTC).');
    expect(axiosGetSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/members/quota',
      expect.objectContaining({
        headers: { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' },
      }),
    );
  });

  it('returns a monthly quota message when daily usage is still below the limit', async () => {
    axiosPostSpy.mockRejectedValueOnce(
      new AxiosError('quota exceeded', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: { headers: {} } as any,
        data: {
          errorCode: 'QUOTA_EXCEEDED',
          message: 'CO_ACTION_QUOTA_EXCEEDED',
        },
      }),
    );
    axiosGetSpy.mockResolvedValueOnce({
      data: {
        data: {
          coAction: {
            daily: { used: 3, limit: 5 },
            monthly: { used: 100, limit: 100 },
          },
        },
      },
    } as any);

    const result = await executeCoActionCommand(
      'http://localhost:3001',
      { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' },
      'create',
      {
        projectId: 'project_1',
        title: 'Quota test',
        content: 'body',
      },
    );

    expect(result).toBe('Monthly limit reached: 100/100 used. Resets next month (UTC).');
  });
});
