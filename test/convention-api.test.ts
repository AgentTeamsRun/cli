import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';
import axios from 'axios';
import { downloadAllConventions, getConvention, listConventions } from '../src/api/convention.js';
import { conventionList, conventionShow } from '../src/commands/convention.js';

const API_URL = 'http://localhost:3001';
const PROJECT_ID = 'project-1';
const HEADERS = { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' };

describe('convention api client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('listConventions preserves the query params and the data/meta envelope', async () => {
    const envelope = {
      data: [{ id: 'c1', title: 'testing', category: 'rules' }],
      meta: { total: 1, page: 2, pageSize: 50, totalPages: 3 },
    };
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: envelope } as never);

    const result = await listConventions(API_URL, PROJECT_ID, HEADERS, {
      scope: 'PERSONAL',
      archived: 'ACTIVE',
      page: 2,
      pageSize: 50,
    });

    expect(getSpy).toHaveBeenCalledWith(`${API_URL}/api/projects/${PROJECT_ID}/conventions`, {
      headers: HEADERS,
      params: { scope: 'PERSONAL', archived: 'ACTIVE', page: 2, pageSize: 50 },
    });
    expect(result).toEqual(envelope);
  });

  it('listConventions omits the params key when no params are given', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } } as never);

    await listConventions(API_URL, PROJECT_ID, HEADERS);

    expect(getSpy).toHaveBeenCalledWith(`${API_URL}/api/projects/${PROJECT_ID}/conventions`, { headers: HEADERS });
  });

  it('getConvention fetches the single-detail envelope and normalizes a trailing slash', async () => {
    const envelope = { data: { id: 'c1', title: 'testing', contentMarkdown: '# Testing rules' } };
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: envelope } as never);

    const result = await getConvention(`${API_URL}/`, PROJECT_ID, HEADERS, 'c1');

    expect(getSpy).toHaveBeenCalledWith(`${API_URL}/api/projects/${PROJECT_ID}/conventions/c1`, { headers: HEADERS });
    expect(result).toEqual(envelope);
  });

  it('downloadAllConventions fetches the bulk-content envelope verbatim', async () => {
    const envelope = { data: [{ id: 'c1', contentMarkdown: '# Testing rules', scope: 'PROJECT' }] };
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: envelope } as never);

    const result = await downloadAllConventions(API_URL, PROJECT_ID, HEADERS);

    expect(getSpy).toHaveBeenCalledWith(`${API_URL}/api/projects/${PROJECT_ID}/conventions/download-all`, {
      headers: HEADERS,
    });
    expect(result).toEqual(envelope);
  });
});

/**
 * Characterization: the command flows must behave exactly as they did when the
 * HTTP calls were inlined — page walking, item merging and text output are
 * asserted against the pre-extraction behaviour.
 */
describe('convention commands delegating to the api client', () => {
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = ['AGENTTEAMS_API_URL', 'AGENTTEAMS_API_KEY', 'AGENTTEAMS_TEAM_ID', 'AGENTTEAMS_PROJECT_ID'];

  beforeEach(() => {
    for (const key of ENV_KEYS) envBackup[key] = process.env[key];
    process.env.AGENTTEAMS_API_URL = API_URL;
    process.env.AGENTTEAMS_API_KEY = 'key_test';
    process.env.AGENTTEAMS_TEAM_ID = 'team-1';
    process.env.AGENTTEAMS_PROJECT_ID = PROJECT_ID;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    }
    jest.restoreAllMocks();
  });

  it('conventionList walks every page exactly as before the extraction', async () => {
    const pageOne = {
      data: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, title: `conv ${i}` })),
      meta: { total: 101, page: 1, pageSize: 100, totalPages: 2 },
    };
    const pageTwo = {
      data: [{ id: 'c100', title: 'conv 100' }],
      meta: { total: 101, page: 2, pageSize: 100, totalPages: 2 },
    };
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: pageOne } as never)
      .mockResolvedValueOnce({ data: pageTwo } as never);

    const result = await conventionList();

    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(getSpy).toHaveBeenNthCalledWith(1, `${API_URL}/api/projects/${PROJECT_ID}/conventions`, {
      headers: HEADERS,
      params: { page: 1, pageSize: 100 },
    });
    expect(getSpy).toHaveBeenNthCalledWith(2, `${API_URL}/api/projects/${PROJECT_ID}/conventions`, {
      headers: HEADERS,
      params: { page: 2, pageSize: 100 },
    });
    expect(result.data).toHaveLength(101);
    expect(result.meta).toEqual({ total: 101, page: 1, pageSize: 101, totalPages: 1 });
  });

  it('conventionShow renders download-all content exactly as before the extraction', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        data: [
          { id: 'c1', title: 'testing', category: 'rules', contentMarkdown: '# Testing' },
          { id: 'c2', title: 'routes', category: 'rules', contentMarkdown: '# Routes' },
        ],
      },
    } as never);

    const result = await conventionShow();

    expect(result).toBe(
      '# testing\ncategory: rules\nid: c1\n\n# Testing\n\n---\n\n# routes\ncategory: rules\nid: c2\n\n# Routes',
    );
  });

  it('conventionShow keeps the invalid-format error when download-all returns junk', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: 'not-an-array' } } as never);

    await expect(conventionShow()).rejects.toThrow('Invalid download-all response format');
  });
});
