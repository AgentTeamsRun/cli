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

  // 코액션 생성 쿼터가 상품 한도에서 빠지면서 403 QUOTA_EXCEEDED 안내 분기도 사라졌다.
  // 남은 계약은 "서버 에러를 그대로 올린다" 하나이며, 쿼터 스냅샷 조회도 더는 하지 않는다.
  it('rethrows a 403 from coaction create without looking up a quota snapshot', async () => {
    const error = new AxiosError('forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      config: { headers: {} } as any,
      data: {
        errorCode: 'QUOTA_EXCEEDED',
        message: 'CO_ACTION_QUOTA_EXCEEDED',
      },
    });
    axiosPostSpy.mockRejectedValueOnce(error);

    await expect(
      executeCoActionCommand(
        'http://localhost:3001',
        { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' },
        'create',
        {
          projectId: 'project_1',
          title: 'Quota test',
          content: 'body',
        },
      ),
    ).rejects.toBe(error);

    expect(axiosGetSpy).not.toHaveBeenCalledWith('http://localhost:3001/api/members/quota', expect.anything());
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
