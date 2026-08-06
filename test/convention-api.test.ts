import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';
import axios from 'axios';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAllConventions, getConvention, listConventions } from '../src/api/convention.js';
import { conventionDownload, conventionList, conventionShow } from '../src/commands/convention.js';

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

/**
 * `init`은 방금 연결한 AgentConfig를 알고 있으므로, 템플릿을 고르려고 목록을 다시 조회할 이유가
 * 없다. 직접 `agentteams convention download`를 실행하는 사용자에게는 고를 근거가 없어 기존
 * "목록 → 첫 항목" 폴백이 남아 있어야 한다.
 */
describe('conventionDownload agent config selection', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  const createTempProject = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'agentteams-convention-'));
    mkdirSync(join(root, '.agentteams'), { recursive: true });
    writeFileSync(
      join(root, '.agentteams', 'config.json'),
      JSON.stringify({ projectId: PROJECT_ID, teamId: 'team-1' }),
      'utf-8',
    );
    return root;
  };

  const mockDownloadResponses = (): string[] => {
    const requestedUrls: string[] = [];
    jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith('/api/platform/guides')) return { data: { data: [] } };
      if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
      if (url.endsWith('/agent-configs')) return { data: { data: [{ id: 'agent-first' }] } };
      if (url.endsWith('/convention')) return { data: { data: { content: '# AGENT_RULES\n' } } };
      if (url.endsWith('/download-all')) return { data: { data: [] } };
      throw new Error(`unexpected GET ${url}`);
    }) as never);
    return requestedUrls;
  };

  const download = (root: string, agentConfigId?: string) =>
    conventionDownload({
      cwd: root,
      config: { projectId: PROJECT_ID, teamId: 'team-1', apiUrl: API_URL, apiKey: 'key_test' } as never,
      ...(agentConfigId ? { agentConfigId } : {}),
    });

  const conventionMarkdown = (root: string) => readFileSync(join(root, '.agentteams', 'convention.md'), 'utf-8');

  it('skips the agent-config list request when the caller already knows the config id', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const requestedUrls = mockDownloadResponses();

    await download(root, 'agent-chosen');

    expect(requestedUrls).not.toContain(`${API_URL}/api/projects/${PROJECT_ID}/agent-configs`);
    expect(requestedUrls).toContain(`${API_URL}/api/projects/${PROJECT_ID}/agent-configs/agent-chosen/convention`);
    expect(conventionMarkdown(root)).toBe('# AGENT_RULES\n');
  });

  it('keeps the list-then-first-item fallback when no config id is given', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const requestedUrls = mockDownloadResponses();

    await download(root);

    expect(requestedUrls).toContain(`${API_URL}/api/projects/${PROJECT_ID}/agent-configs`);
    expect(requestedUrls).toContain(`${API_URL}/api/projects/${PROJECT_ID}/agent-configs/agent-first/convention`);
    expect(conventionMarkdown(root)).toBe('# AGENT_RULES\n');
  });
});
