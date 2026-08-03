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

  describe('list filters', () => {
    const apiUrl = 'http://localhost:3001';
    const headers = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };
    const listUrl = `${apiUrl}/api/projects/project_1/co-actions`;

    /**
     * `list` runs a silent freshness check before the list request, so the
     * list call has to be selected by URL rather than by call order.
     */
    function listRequestParams(): unknown {
      const call = axiosGetSpy.mock.calls.find(([url]) => url === listUrl);
      expect(call).toBeDefined();
      return (call?.[1] as { params?: unknown } | undefined)?.params;
    }

    beforeEach(() => {
      axiosGetSpy.mockResolvedValue({
        data: { data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } },
      } as any);
    });

    it('defaults the source filter to MANUAL when --source is omitted', async () => {
      await executeCoActionCommand(apiUrl, headers, 'list', { projectId: 'project_1' });

      expect(listRequestParams()).toEqual({ source: 'MANUAL' });
    });

    it('preserves an explicit --source AUTO_SESSION', async () => {
      await executeCoActionCommand(apiUrl, headers, 'list', {
        projectId: 'project_1',
        source: 'AUTO_SESSION',
      });

      expect(listRequestParams()).toEqual({ source: 'AUTO_SESSION' });
    });

    it('sends no source filter for --source ALL', async () => {
      await executeCoActionCommand(apiUrl, headers, 'list', {
        projectId: 'project_1',
        source: 'ALL',
        status: 'OPEN',
      });

      expect(listRequestParams()).toEqual({ status: 'OPEN' });
    });

    it('normalizes lowercase --source all to the ALL escape hatch', async () => {
      await executeCoActionCommand(apiUrl, headers, 'list', {
        projectId: 'project_1',
        source: ' all ',
        status: 'OPEN',
      });

      expect(listRequestParams()).toEqual({ status: 'OPEN' });
    });

    it('rejects an unsupported --source value before listing co-actions', async () => {
      await expect(
        executeCoActionCommand(apiUrl, headers, 'list', {
          projectId: 'project_1',
          source: 'manul',
        }),
      ).rejects.toThrow('--source must be one of: MANUAL, AUTO_SESSION, ALL');

      expect(axiosGetSpy).not.toHaveBeenCalledWith(listUrl, expect.anything());
    });

    it('passes --visibility through to the list request', async () => {
      await executeCoActionCommand(apiUrl, headers, 'list', {
        projectId: 'project_1',
        visibility: 'PRIVATE',
      });

      expect(listRequestParams()).toEqual({ visibility: 'PRIVATE', source: 'MANUAL' });
    });
  });
});
