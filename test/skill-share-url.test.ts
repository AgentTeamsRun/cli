import { afterEach, describe, expect, it, jest } from '@jest/globals';
import httpClient from '../src/utils/httpClient.js';
import { getSharedSkill, listSharedSkills } from '../src/api/skill.js';

const apiUrl = 'https://api.test';
const projectId = 'project-1';
const headers = { Authorization: 'Bearer token' };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('shared skills consumer endpoints', () => {
  it('browse calls the consumer project shared list URL', async () => {
    const payload = { data: [], meta: { total: 0 } };
    const get = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: payload } as never);

    const result = await listSharedSkills(apiUrl, projectId, headers, { search: 'deploy' });

    expect(result).toEqual(payload);
    expect(get).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/skills/shared`, {
      headers,
      params: { search: 'deploy' },
    });
  });

  it('detail calls the consumer project shared detail URL', async () => {
    const payload = { data: { id: 'share-1' } };
    const get = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: payload } as never);

    const result = await getSharedSkill(apiUrl, projectId, headers, 'share-1');

    expect(result).toEqual(payload);
    expect(get).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/skills/shared/share-1`, { headers });
  });
});
