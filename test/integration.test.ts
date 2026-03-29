import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import axios, { AxiosError } from 'axios';
import { executeCommand } from '../src/commands/index.js';
import { formatOutput } from '../src/utils/formatter.js';
import { handleError } from '../src/utils/errors.js';

const PROJECT_ID = 'project_1';
const API_URL = 'http://localhost:3001';

function authHeaders() {
  return {
    'X-API-Key': 'key_test123',
    'Content-Type': 'application/json',
  };
}

function deleteHeaders() {
  return {
    'X-API-Key': 'key_test123',
  };
}

describe('CLI Integration Tests', () => {
  const originalEnv = process.env;
  let axiosGetSpy: jest.SpiedFunction<typeof axios.get>;
  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;
  let axiosPatchSpy: jest.SpiedFunction<typeof axios.patch>;
  let axiosPutSpy: jest.SpiedFunction<typeof axios.put>;
  let axiosDeleteSpy: jest.SpiedFunction<typeof axios.delete>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AGENTTEAMS_API_KEY: 'key_test123',
      AGENTTEAMS_API_URL: API_URL,
      AGENTTEAMS_TEAM_ID: 'team_1',
      AGENTTEAMS_PROJECT_ID: PROJECT_ID,
      AGENTTEAMS_AGENT_NAME: 'test-agent',
    };

    axiosGetSpy = jest.spyOn(axios, 'get');
    axiosPostSpy = jest.spyOn(axios, 'post');
    axiosPatchSpy = jest.spyOn(axios, 'patch');
    axiosPutSpy = jest.spyOn(axios, 'put');
    axiosDeleteSpy = jest.spyOn(axios, 'delete');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Commands', () => {
    it('init start: should complete OAuth flow with mocked callback', async () => {
      if (typeof (jest as any).unstable_mockModule !== 'function') {
        return;
      }

      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-init-success-'));
      const closeSpy = jest.fn();
      const callbackPayload = {
        teamId: 'team_1',
        projectId: PROJECT_ID,
        repositoryId: 'repo-1',
        agentName: 'test-agent',
        apiKey: 'key_oauth_123',
        apiUrl: API_URL,
        configId: '7',
      };

      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: { content: '# team convention\n- follow rules\n' } } } as any)
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# team convention\n- follow rules\n' } } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { fileName: 'plan-guide.md', content: '# plan guide\n' },
              { fileName: 'completion-report-guide.md', content: '# completion report guide\n' },
              { fileName: 'post-mortem-guide.md', content: '# post mortem guide\n' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: [] } } as any)
        .mockResolvedValueOnce({ data: { data: { hash: 'platform-guides-hash-init-1' } } } as any);

      const mockStartLocalAuthServer = jest.fn().mockReturnValue({
        server: {
          listening: true,
          close: closeSpy,
        } as any,
        waitForCallback: async () => callbackPayload,
        port: 7779,
      });

      if (typeof (jest as any).resetModules === 'function') {
        (jest as any).resetModules();
      }
      (jest as any).unstable_mockModule('axios', () => ({
        default: axios,
        isAxiosError: axios.isAxiosError,
      }));
      (jest as any).unstable_mockModule('../src/utils/authServer.js', () => ({
        startLocalAuthServer: mockStartLocalAuthServer,
      }));
      (jest as any).unstable_mockModule('open', () => ({
        default: jest.fn().mockImplementation(async () => undefined),
      }));

      const { executeInitCommand } = await import('../src/commands/init.js');
      const result = await executeInitCommand({ cwd: tempCwd });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          authUrl: expect.stringContaining('/cli/authorize?port=7779'),
          configPath: join(tempCwd, '.agentteams', 'config.json'),
          conventionPath: join(tempCwd, '.agentteams', 'convention.md'),
          teamId: 'team_1',
          projectId: PROJECT_ID,
          agentName: 'test-agent',
        })
      );
      const parsedAuthUrl = new URL(result.authUrl);
      expect(parsedAuthUrl.searchParams.get('ap')).toBeTruthy();
      expect(result.authUrl).not.toContain(tempCwd);

      const savedConfig = JSON.parse(readFileSync(result.configPath, 'utf-8'));
      expect(savedConfig).toEqual({
        teamId: 'team_1',
        projectId: PROJECT_ID,
        repositoryId: 'repo-1',
        agentName: 'test-agent',
        apiKey: 'key_oauth_123',
        apiUrl: API_URL,
      });

      const savedConvention = readFileSync(result.conventionPath, 'utf-8');
      expect(savedConvention).toBe('# team convention\n- follow rules\n');
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/agent-configs/7/convention`,
        {
          headers: {
            'X-API-Key': 'key_oauth_123',
            'Content-Type': 'application/json',
          },
        }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/agent-configs`,
        {
          headers: {
            'X-API-Key': 'key_oauth_123',
            'Content-Type': 'application/json',
          },
        }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/conventions/download-all`,
        {
          headers: {
            'X-API-Key': 'key_oauth_123',
            'Content-Type': 'application/json',
          },
        }
      );

      rmSync(tempCwd, { recursive: true, force: true });
    });

    it('sync download: should download conventions by category', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# reporting from sync\n' } } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { fileName: 'plan-guide.md', content: '# plan guide\n' },
              { fileName: 'completion-report-guide.md', content: '# completion report guide\n' },
              { fileName: 'post-mortem-guide.md', content: '# post mortem guide\n' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { id: 'cv-1', title: 'Core Rules', category: 'rules', contentMarkdown: '# core rules' },
              { id: 'cv-2', title: 'API Rules', category: 'rules', contentMarkdown: '# api rules' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: { hash: 'platform-guides-hash-1' } } } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-sync-download-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        await executeCommand('sync', 'download', { cwd: tempCwd });

         const downloadedCore = readFileSync(join(agentteamsDir, 'rules', 'core-rules.md'), 'utf-8');
         const downloadedApi = readFileSync(join(agentteamsDir, 'rules', 'api-rules.md'), 'utf-8');
       const reporting = readFileSync(join(agentteamsDir, 'convention.md'), 'utf-8');
          const planGuide = readFileSync(join(agentteamsDir, 'platform', 'plan-guide.md'), 'utf-8');
          expect(downloadedCore).toBe('# core rules');
         expect(downloadedApi).toBe('# api rules');
         expect(reporting).toBe('# reporting from sync\n');
         expect(planGuide).toBe('# plan guide\n');
       } finally {
         process.chdir(originalCwd);
         rmSync(tempCwd, { recursive: true, force: true });
       }
     });

    it('plan CRUD/assign: should use project-scoped plan endpoints', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);
      axiosGetSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);
      axiosPutSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      await executeCommand('plan', 'create', {
        title: 'Plan 1',
        content: 'content',
        priority: 'HIGH',
      });
      await executeCommand('plan', 'list', {});
      await executeCommand('plan', 'get', { id: 'plan-1' });
      await executeCommand('plan', 'show', { id: 'plan-1' });
      await executeCommand('plan', 'update', { id: 'plan-1', status: 'IN_PROGRESS' });
      await executeCommand('plan', 'assign', { id: 'plan-1', agent: 'agent-a' });
      await executeCommand('plan', 'delete', { id: 'plan-1' });

      expect(axiosPostSpy).toHaveBeenNthCalledWith(
        1,
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        expect.objectContaining({
          title: 'Plan 1',
          content: 'content',
          priority: 'HIGH',
        }),
        { headers: authHeaders() }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        { headers: authHeaders() }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { headers: authHeaders() }
      );
      expect(axiosPutSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { status: 'IN_PROGRESS' },
        { headers: authHeaders() }
      );
      expect(axiosPostSpy).toHaveBeenNthCalledWith(
        2,
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/assign`,
        { assignedTo: 'agent-a' },
        { headers: authHeaders() }
      );
      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { headers: deleteHeaders() }
      );
    });

    it('linear issue get: should call the linear issue endpoint', async () => {
      axiosGetSpy.mockResolvedValue({
        data: {
          data: {
            id: 'issue-1',
            identifier: 'AGE-5',
            title: 'Linear issue',
          },
        },
      } as any);

      const result = await executeCommand('linear', 'issue-get', {
        issueId: 'issue-1',
      });

      expect(result).toEqual({
        data: {
          id: 'issue-1',
          identifier: 'AGE-5',
          title: 'Linear issue',
        },
      });
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/linear/issues/issue-1`,
        { headers: authHeaders() }
      );
    });

    it('linear comment create: should post to the linear comment endpoint', async () => {
      axiosPostSpy.mockResolvedValue({
        data: {
          data: {
            id: 'comment-1',
            body: 'Created from CLI',
          },
        },
      } as any);

      const result = await executeCommand('linear', 'comment-create', {
        issueId: 'issue-1',
        body: 'Created from CLI',
      });

      expect(result).toEqual({
        data: {
          id: 'comment-1',
          body: 'Created from CLI',
        },
      });
      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/linear/issues/issue-1/comments`,
        { body: 'Created from CLI' },
        { headers: authHeaders() }
      );
    });

    it('plan get with include-deps: should fetch dependency endpoint and merge data', async () => {
      axiosGetSpy.mockImplementation(async (url: string) => {
        if (url === `${API_URL}/api/platform/guides/hash`) {
          return { data: { data: { hash: 'platform-guides-hash-1' } } } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/conventions`) {
          return { data: { data: [] } } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`) {
          return {
            data: {
              data: {
                id: 'plan-1',
                title: 'Main Plan',
                status: 'IN_PROGRESS',
              },
            },
          } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/dependencies`) {
          return {
            data: {
              data: {
                blocking: [{ id: 'p-2', title: 'Blocker', status: 'PENDING' }],
                dependents: [{ id: 'p-3', title: 'Dependent', status: 'PENDING' }],
              },
            },
          } as any;
        }

        throw new Error(`Unhandled axios.get URL in test: ${url}`);
      });

      const result = await executeCommand('plan', 'get', {
        id: 'plan-1',
        includeDeps: true,
        format: 'json',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { headers: authHeaders() }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/dependencies`,
        { headers: authHeaders() }
      );
      expect((result as any).data.dependencies).toEqual({
        blocking: [{ id: 'p-2', title: 'Blocker', status: 'PENDING' }],
        dependents: [{ id: 'p-3', title: 'Dependent', status: 'PENDING' }],
      });
    });

    it('plan show with include-deps and text: should render dependency section', async () => {
      axiosGetSpy.mockImplementation(async (url: string) => {
        if (url === `${API_URL}/api/platform/guides/hash`) {
          return { data: { data: { hash: 'platform-guides-hash-1' } } } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/conventions`) {
          return { data: { data: [] } } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`) {
          return {
            data: {
              data: {
                id: 'plan-1',
                title: 'Main Plan',
                status: 'IN_PROGRESS',
              },
            },
          } as any;
        }
        if (url === `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/dependencies`) {
          return { data: { data: { blocking: [], dependents: [] } } } as any;
        }

        throw new Error(`Unhandled axios.get URL in test: ${url}`);
      });

      const result = await executeCommand('plan', 'show', {
        id: 'plan-1',
        includeDeps: true,
        format: 'text',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { headers: authHeaders() }
      );
      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/dependencies`,
        { headers: authHeaders() }
      );
      expect(typeof result).toBe('string');
      expect(String(result)).toContain('## Dependencies');
      expect(String(result)).toContain('No dependencies.');
    });

    it('plan status: should call GET /plans/:id/status', async () => {
      axiosGetSpy.mockResolvedValue({
        data: { data: { id: 'plan-1', status: 'IN_PROGRESS' } },
      } as any);

      await executeCommand('plan', 'status', { id: 'plan-1' });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/status`,
        { headers: authHeaders() }
      );
    });

    it('plan status: should throw when --id is missing', async () => {
      await expect(executeCommand('plan', 'status', {}))
        .rejects.toThrow('--id is required for plan status');
    });

    it('plan set-status: should call PATCH /plans/:id/status', async () => {
      axiosPatchSpy.mockResolvedValue({
        data: { data: { id: 'plan-1', status: 'PENDING' } },
      } as any);

      await executeCommand('plan', 'set-status', { id: 'plan-1', status: 'PENDING' });

      expect(axiosPatchSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/status`,
        { status: 'PENDING' },
        { headers: authHeaders() }
      );
    });

    it('plan set-status: should throw when --id or --status is missing', async () => {
      await expect(executeCommand('plan', 'set-status', { status: 'PENDING' }))
        .rejects.toThrow('--id is required for plan set-status');
      await expect(executeCommand('plan', 'set-status', { id: 'plan-1' }))
        .rejects.toThrow('--status is required for plan set-status');
    });

    it('plan create: should interpret \\\\n sequences when interpretEscapes is enabled', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);

      await executeCommand('plan', 'create', {
        title: 'Plan 1',
        content: 'Line1\\nLine2',
        interpretEscapes: true,
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        expect.objectContaining({
          title: 'Plan 1',
          content: 'Line1\nLine2',
        }),
        { headers: authHeaders() }
      );
    });

    it('plan create: should use refactor-minimal template when content is missing', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);

      await executeCommand('plan', 'create', {
        title: 'Plan with template',
        template: 'refactor-minimal',
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        expect.objectContaining({
          title: 'Plan with template',
          content: expect.stringContaining('## Refactor Checklist'),
        }),
        { headers: authHeaders() }
      );
    });

    it('plan create: should use quick-minimal template when content is missing', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);

      await executeCommand('plan', 'create', {
        title: 'Quick plan',
        template: 'quick-minimal',
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        expect.objectContaining({
          title: 'Quick plan',
          content: expect.stringContaining('## TL;DR'),
        }),
        { headers: authHeaders() }
      );
    });

    it('plan update: should interpret \\\\n sequences when interpretEscapes is enabled', async () => {
      axiosPutSpy.mockResolvedValue({ data: { data: { id: 't1' } } } as any);

      await executeCommand('plan', 'update', {
        id: 'plan-1',
        content: 'Line1\\nLine2',
        interpretEscapes: true,
      });

      expect(axiosPutSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1`,
        { content: 'Line1\nLine2' },
        { headers: authHeaders() }
      );
    });

    it('plan list: should pass status filter as query params', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);

      await executeCommand('plan', 'list', { status: 'PENDING' });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        { headers: authHeaders(), params: { status: 'PENDING' } }
      );
    });

    it('plan list: should pass extended filters and pagination', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);

      await executeCommand('plan', 'list', {
        title: 'CLI bug',
        search: 'pending',
        assignedTo: 'acfg-1',
        page: '3',
        pageSize: '25',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans`,
        {
          headers: authHeaders(),
          params: {
            title: 'CLI bug',
            search: 'pending',
            assignedTo: 'acfg-1',
            page: 3,
            pageSize: 25,
          },
        }
      );
    });

    it('plan start: should call single lifecycle endpoint', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'plan-1' } } } as any);

      await executeCommand('plan', 'start', { id: 'plan-1' });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/start`,
        expect.objectContaining({ assignedTo: 'test-agent' }),
        { headers: authHeaders() }
      );
    });

    it('plan start: should pass custom task to lifecycle endpoint', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'plan-1' } } } as any);

      await executeCommand('plan', 'start', { id: 'plan-1', task: 'Work started custom' });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/start`,
        expect.objectContaining({ assignedTo: 'test-agent', task: 'Work started custom' }),
        { headers: authHeaders() }
      );
    });

    it('plan start: should fail when lifecycle endpoint fails', async () => {
      axiosPostSpy.mockRejectedValue(new Error('start failed'));

      await expect(executeCommand('plan', 'start', { id: 'plan-1' })).rejects.toThrow('start failed');

      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    });

    it('plan finish: should call single lifecycle endpoint', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'plan-1' } } } as any);

      await executeCommand('plan', 'finish', { id: 'plan-1' });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/finish`,
        {},
        { headers: authHeaders() }
      );
    });

    it('plan finish: should include completion report when report file is provided', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'plan-1' } } } as any);

      const reportDir = mkdtempSync(join(tmpdir(), 'report-'));
      const reportFile = join(reportDir, 'report.md');
      writeFileSync(reportFile, '## Summary\n- done', 'utf-8');

      await executeCommand('plan', 'finish', {
        id: 'plan-1',
        reportTitle: 'Completion summary',
        reportFile,
        git: false,
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/finish`,
        {
          completionReport: {
            title: 'Completion summary',
            content: '## Summary\n- done',
          },
        },
        { headers: authHeaders() }
      );

      rmSync(reportDir, { recursive: true, force: true });
    });

    it('comment CRUD: should use project-scoped endpoints and required type', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'c1' } } } as any);
      axiosPutSpy.mockResolvedValue({ data: { data: { id: 'c1' } } } as any);
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      await executeCommand('comment', 'list', { planId: 'plan-1' });
      await executeCommand('comment', 'get', { id: 'comment-1' });
      await executeCommand('comment', 'create', {
        planId: 'plan-1',
        type: 'GENERAL',
        content: 'Test comment',
      });
      await executeCommand('comment', 'update', {
        id: 'comment-1',
        content: 'Updated',
      });
      await executeCommand('comment', 'delete', { id: 'comment-1' });

      expect(axiosGetSpy).toHaveBeenNthCalledWith(
        1,
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/comments`,
        { headers: authHeaders() }
      );
      expect(axiosGetSpy).toHaveBeenNthCalledWith(
        2,
        `${API_URL}/api/projects/${PROJECT_ID}/comments/comment-1`,
        { headers: authHeaders() }
      );
      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/comments`,
        {
          type: 'GENERAL',
          content: 'Test comment',
        },
        { headers: authHeaders() }
      );
      expect(axiosPutSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/comments/comment-1`,
        { content: 'Updated' },
        { headers: authHeaders() }
      );
      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/comments/comment-1`,
        { headers: deleteHeaders() }
      );
    });

    it('comment list: should pass type and pagination filters', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);

      await executeCommand('comment', 'list', {
        planId: 'plan-1',
        type: 'RISK',
        page: '2',
        pageSize: '20',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/plan-1/comments`,
        {
          headers: authHeaders(),
          params: { type: 'RISK', page: 2, pageSize: 20 },
        }
      );
    });

    it('dependency commands: should use project-scoped URL and blockingPlanId', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: { blocking: [], dependents: [] } } } as any);
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'dep-1' } } } as any);
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      const planId = '5cc7f9eb-f3f3-40af-9a1e-4f8ef2db2e65';
      const blockingPlanId = '255090be-80b0-4a5d-9bf0-0fd4d8c6616f';

      await executeCommand('dependency', 'list', { planId });
      await executeCommand('dependency', 'create', { planId, blockingPlanId });
      await executeCommand('dependency', 'delete', { planId, depId: 'dep-1' });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/${planId}/dependencies`,
        { headers: authHeaders() }
      );
      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/${planId}/dependencies`,
        { blockingPlanId },
        { headers: authHeaders() }
      );
      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/plans/${planId}/dependencies/dep-1`,
        { headers: deleteHeaders() }
      );
      expect(axiosPostSpy.mock.calls[0]?.[0]).not.toContain('NaN');
    });

    it('convention list: should call project-scoped list endpoint', async () => {
      axiosGetSpy.mockResolvedValueOnce({ data: { data: [{ id: 'cv-1' }] } } as any);

      await executeCommand('convention', 'list', {});

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/conventions`,
        { headers: authHeaders(), params: { page: 1, pageSize: 100 } }
      );
    });

    it('convention show: should fetch full markdown for all conventions', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({
          data: {
            data: [{ id: 'cv-1', title: 'Core', category: 'rules', contentMarkdown: '# full markdown' }],
          },
        } as any);

      const result = await executeCommand('convention', 'show', {});

      expect(typeof result).toBe('string');
      expect(result).toContain('# Core');
      expect(result).toContain('category: rules');
      expect(result).toContain('id: cv-1');
      expect(result).toContain('# full markdown');
      expect(axiosGetSpy).toHaveBeenNthCalledWith(
        1,
        `${API_URL}/api/projects/${PROJECT_ID}/conventions/download-all`,
        { headers: authHeaders() }
      );
    });

    it('convention download: should write convention files and update convention.md', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# reporting template\n' } } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { fileName: 'plan-guide.md', content: '# plan guide\n' },
              { fileName: 'completion-report-guide.md', content: '# completion report guide\n' },
              { fileName: 'post-mortem-guide.md', content: '# post mortem guide\n' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { id: 'cv-1', title: 'Core Rules', category: 'rules', contentMarkdown: '# downloaded convention 1' },
              { id: 'cv-2', title: 'API Rule', category: 'rules', contentMarkdown: '# downloaded convention 2' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: { hash: 'platform-guides-hash-2' } } } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-update-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );
        writeFileSync(join(agentteamsDir, 'convention.md'), '# convention baseline\n', 'utf-8');

        process.chdir(tempCwd);
        await executeCommand('convention', 'download', {});

        const downloadedFile1 = readFileSync(join(agentteamsDir, 'rules', 'core-rules.md'), 'utf-8');
        const downloadedFile2 = readFileSync(join(agentteamsDir, 'rules', 'api-rule.md'), 'utf-8');
        const reportingContent = readFileSync(join(agentteamsDir, 'convention.md'), 'utf-8');
        const planGuide = readFileSync(join(agentteamsDir, 'platform', 'plan-guide.md'), 'utf-8');
        const manifestRaw = readFileSync(join(agentteamsDir, 'conventions.manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestRaw) as any;

        expect(downloadedFile1).toBe('# downloaded convention 1');
        expect(downloadedFile2).toBe('# downloaded convention 2');
        expect(reportingContent).toBe('# reporting template\n');
        expect(planGuide).toBe('# plan guide\n');
        expect(manifest.version).toBe(1);
        expect(Array.isArray(manifest.entries)).toBe(true);
        expect(manifest.entries.length).toBe(2);
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention update: should dry-run diff and not upload', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({
          data: { data: { id: 'cv-1', updatedAt: '2026-01-01T00:00:00.000Z' } },
        } as any)
        .mockResolvedValueOnce({ data: '# server version\n' } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-update-dryrun-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        mkdirSync(join(agentteamsDir, 'rules'), { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        const filePath = join(agentteamsDir, 'rules', 'core-rules.md');
        writeFileSync(filePath, '# local version\n', 'utf-8');

        writeFileSync(
          join(agentteamsDir, 'conventions.manifest.json'),
          JSON.stringify(
            {
              version: 1,
              generatedAt: '2026-01-01T00:00:00.000Z',
              entries: [
                {
                  conventionId: 'cv-1',
                  fileRelativePath: '.agentteams/rules/core-rules.md',
                  fileName: 'core-rules.md',
                  categoryDir: 'rules',
                  downloadedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        const result = await executeCommand('convention', 'update', {
          cwd: tempCwd,
          file: [filePath],
          apply: false,
        });

        expect(typeof result).toBe('string');
        expect(result).toContain('server version');
        expect(result).toContain('local version');
        expect(axiosPutSpy).not.toHaveBeenCalled();
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention update: should upload when --apply is set', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({
          data: { data: { id: 'cv-1', updatedAt: '2026-01-01T00:00:00.000Z' } },
        } as any)
        .mockResolvedValueOnce({ data: '# server version\n' } as any);

      axiosPutSpy.mockResolvedValueOnce({
        data: { data: { id: 'cv-1', updatedAt: '2026-02-01T00:00:00.000Z', webUrl: 'https://app.example/conventions/cv-1' } },
      } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-update-apply-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        mkdirSync(join(agentteamsDir, 'rules'), { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        const filePath = join(agentteamsDir, 'rules', 'core-rules.md');
        writeFileSync(
          filePath,
          [
            '---',
            'trigger: always_on',
            'description: 테스트 설명',
            'agentInstruction: |',
            '  line1',
            '  line2',
            '---',
            '',
            '# local version',
            '',
          ].join('\n'),
          'utf-8'
        );

        writeFileSync(
          join(agentteamsDir, 'conventions.manifest.json'),
          JSON.stringify(
            {
              version: 1,
              generatedAt: '2026-01-01T00:00:00.000Z',
              entries: [
                {
                  conventionId: 'cv-1',
                  fileRelativePath: '.agentteams/rules/core-rules.md',
                  fileName: 'core-rules.md',
                  categoryDir: 'rules',
                  downloadedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        const result = await executeCommand('convention', 'update', {
          cwd: tempCwd,
          file: [filePath],
          apply: true,
        });

        expect(typeof result).toBe('string');
        expect(result).toContain('[OK]');
        expect(result).toContain('webUrl: https://app.example/conventions/cv-1');

        expect(axiosPutSpy).toHaveBeenCalledWith(
          `${API_URL}/api/projects/${PROJECT_ID}/conventions/cv-1`,
          expect.objectContaining({
            updatedAt: '2026-01-01T00:00:00.000Z',
            trigger: 'always_on',
            description: '테스트 설명',
            agentInstruction: 'line1\nline2',
            content: expect.any(String),
          }),
          { headers: authHeaders() }
        );

        const manifest = JSON.parse(readFileSync(join(agentteamsDir, 'conventions.manifest.json'), 'utf-8')) as any;
        expect(manifest.entries[0].lastUploadedAt).toBeTruthy();
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention update: should resolve .agentteams path from nested cwd', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({
          data: { data: { id: 'cv-1', updatedAt: '2026-01-01T00:00:00.000Z' } },
        } as any)
        .mockResolvedValueOnce({ data: '# server version\n' } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-update-nested-cwd-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        mkdirSync(join(agentteamsDir, 'rules'), { recursive: true });
        mkdirSync(join(tempCwd, 'cli'), { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        const filePath = join(agentteamsDir, 'rules', 'core-rules.md');
        writeFileSync(filePath, '# local version\n', 'utf-8');

        writeFileSync(
          join(agentteamsDir, 'conventions.manifest.json'),
          JSON.stringify(
            {
              version: 1,
              generatedAt: '2026-01-01T00:00:00.000Z',
              entries: [
                {
                  conventionId: 'cv-1',
                  fileRelativePath: '.agentteams/rules/core-rules.md',
                  fileName: 'core-rules.md',
                  categoryDir: 'rules',
                  downloadedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(join(tempCwd, 'cli'));
        const result = await executeCommand('convention', 'update', {
          cwd: process.cwd(),
          file: ['.agentteams/rules/core-rules.md'],
          apply: false,
        });

        expect(typeof result).toBe('string');
        expect(result).toContain('server version');
        expect(result).toContain('local version');
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention delete: should delete convention and cleanup local files when --apply is set', async () => {
      axiosDeleteSpy.mockResolvedValueOnce({ status: 204 } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-delete-apply-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        mkdirSync(join(agentteamsDir, 'rules'), { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        const filePath = join(agentteamsDir, 'rules', 'core-rules.md');
        writeFileSync(filePath, '# local\n', 'utf-8');

        writeFileSync(
          join(agentteamsDir, 'conventions.manifest.json'),
          JSON.stringify(
            {
              version: 1,
              generatedAt: '2026-01-01T00:00:00.000Z',
              entries: [
                {
                  conventionId: 'cv-1',
                  fileRelativePath: '.agentteams/rules/core-rules.md',
                  fileName: 'core-rules.md',
                  categoryDir: 'rules',
                  downloadedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        const result = await executeCommand('convention', 'delete', {
          cwd: tempCwd,
          file: [filePath],
          apply: true,
        });

        expect(typeof result).toBe('string');
        expect(result).toContain('Deleted.');
        expect(existsSync(filePath)).toBe(false);

        const manifest = JSON.parse(readFileSync(join(agentteamsDir, 'conventions.manifest.json'), 'utf-8')) as any;
        expect(manifest.entries.length).toBe(0);
        expect(axiosDeleteSpy).toHaveBeenCalledWith(
          `${API_URL}/api/projects/${PROJECT_ID}/conventions/cv-1`,
          { headers: deleteHeaders() }
        );
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention download: should throw when no .agentteams directory exists', async () => {
      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-missing-'));

      try {
        process.chdir(tempCwd);
        await expect(executeCommand('convention', 'download', {})).rejects.toThrow(
          'No .agentteams directory found'
        );
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention download: should update reporting even when no project conventions', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# reporting template only\n' } } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { fileName: 'plan-guide.md', content: '# plan guide\n' },
              { fileName: 'completion-report-guide.md', content: '# completion report guide\n' },
              { fileName: 'post-mortem-guide.md', content: '# post mortem guide\n' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: [] } } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-template-only-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });
        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        const result = await executeCommand('convention', 'download', {});
        const reporting = readFileSync(join(agentteamsDir, 'convention.md'), 'utf-8');
        const planGuide = readFileSync(join(agentteamsDir, 'platform', 'plan-guide.md'), 'utf-8');

        expect(typeof result).toBe('string');
        expect(result).toContain('No project conventions found');
        expect(reporting).toBe('# reporting template only\n');
        expect(planGuide).toBe('# plan guide\n');
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention download: should add numeric suffix for duplicated names', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# reporting template\n' } } } as any)
        .mockResolvedValueOnce({ data: { data: [] } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [
              { id: 'cv-1', title: 'Rules', category: 'rules', contentMarkdown: '# rules 1' },
              { id: 'cv-2', title: 'Rules', category: 'rules', contentMarkdown: '# rules 2' },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: { hash: 'platform-guides-hash-3' } } } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-duplicate-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(agentteamsDir, { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        process.chdir(tempCwd);
        await executeCommand('convention', 'download', {});

        const file1 = readFileSync(join(agentteamsDir, 'rules', 'rules.md'), 'utf-8');
        const file2 = readFileSync(join(agentteamsDir, 'rules', 'rules-2.md'), 'utf-8');

        expect(file1).toBe('# rules 1');
        expect(file2).toBe('# rules 2');
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention create: should POST and update manifest immediately', async () => {
      axiosPostSpy.mockResolvedValueOnce({
        data: { data: { id: 'cv-new', updatedAt: '2026-02-19T00:00:00.000Z', webUrl: 'https://app.example/conventions/cv-new' } },
      } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-create-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        mkdirSync(join(agentteamsDir, 'rules'), { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        const filePath = join(agentteamsDir, 'rules', 'new-rule.md');
        writeFileSync(
          filePath,
          `---\ntrigger: always_on\ndescription: \"test\"\nagentInstruction: |\n  Do the thing\n---\n\n# New Rule\n\n- ok\n`,
          'utf-8'
        );

        process.chdir(tempCwd);
        const result = await executeCommand('convention', 'create', {
          cwd: tempCwd,
          file: ['.agentteams/rules/new-rule.md'],
        });

        expect(result).toContain('webUrl: https://app.example/conventions/cv-new');

        expect(axiosPostSpy).toHaveBeenCalledWith(
          `${API_URL}/api/projects/${PROJECT_ID}/conventions`,
          expect.objectContaining({
            title: 'new rule',
            category: 'rules',
            fileName: 'new-rule.md',
            content: expect.any(String),
            trigger: 'always_on',
            description: 'test',
            agentInstruction: 'Do the thing',
          }),
          { headers: authHeaders() }
        );

        const manifestRaw = readFileSync(join(agentteamsDir, 'conventions.manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestRaw) as any;
        expect(manifest.version).toBe(1);
        expect(Array.isArray(manifest.entries)).toBe(true);
        expect(manifest.entries).toHaveLength(1);
        expect(manifest.entries[0]).toEqual(
          expect.objectContaining({
            conventionId: 'cv-new',
            fileRelativePath: '.agentteams/rules/new-rule.md',
            fileName: 'new-rule.md',
            categoryDir: 'rules',
            title: 'new rule',
            category: 'rules',
            updatedAt: '2026-02-19T00:00:00.000Z',
            lastKnownUpdatedAt: '2026-02-19T00:00:00.000Z',
          })
        );
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('convention download: should cleanup existing conventions directory before writing', async () => {
      axiosGetSpy
        .mockResolvedValueOnce({ data: { data: [{ id: 'ag-1' }] } } as any)
        .mockResolvedValueOnce({ data: { data: { content: '# reporting template\n' } } } as any)
        .mockResolvedValueOnce({ data: { data: [] } } as any)
        .mockResolvedValueOnce({
          data: {
            data: [{ id: 'cv-1', title: 'Rules', category: 'rules', contentMarkdown: '# latest rules' }],
          },
        } as any)
        .mockResolvedValueOnce({ data: { data: { hash: 'platform-guides-hash-4' } } } as any);

      const originalCwd = process.cwd();
      const tempCwd = mkdtempSync(join(tmpdir(), 'agentteams-convention-cleanup-'));

      try {
        const agentteamsDir = join(tempCwd, '.agentteams');
        const conventionDir = join(agentteamsDir, 'rules');
        mkdirSync(conventionDir, { recursive: true });

        writeFileSync(
          join(agentteamsDir, 'config.json'),
          JSON.stringify(
            {
              teamId: 'team_1',
              projectId: PROJECT_ID,
              agentName: 'test-agent',
              apiKey: 'key_test123',
              apiUrl: API_URL,
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        writeFileSync(join(conventionDir, 'stale.md'), '# stale', 'utf-8');

        process.chdir(tempCwd);
        await executeCommand('convention', 'download', {});

        expect(existsSync(join(conventionDir, 'stale.md'))).toBe(false);
        const downloaded = readFileSync(join(conventionDir, 'rules.md'), 'utf-8');
        expect(downloaded).toBe('# latest rules');
      } finally {
        process.chdir(originalCwd);
        rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it('report command: should remain project-scoped completion report path', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'r1' } } } as any);

      await executeCommand('report', 'list', {});
      const reportDir = mkdtempSync(join(tmpdir(), 'report-'));
      const reportFile = join(reportDir, 'report.md');
      writeFileSync(reportFile, '# Report', 'utf-8');

      await executeCommand('report', 'create', {
        title: 'Test report',
        file: reportFile,
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports`,
        { headers: authHeaders() }
      );
      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports`,
        expect.objectContaining({
          title: 'Test report',
          content: '# Report',
          status: 'COMPLETED',
        }),
        { headers: authHeaders() }
      );
      rmSync(reportDir, { recursive: true, force: true });
    });

    it('report create: should create report from file', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'r1' } } } as any);

      const reportDir = mkdtempSync(join(tmpdir(), 'report-'));
      const reportFile = join(reportDir, 'report.md');
      writeFileSync(reportFile, '## Summary\n- done', 'utf-8');

      await executeCommand('report', 'create', {
        title: 'File report',
        file: reportFile,
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports`,
        expect.objectContaining({
          title: 'File report',
          content: '## Summary\n- done',
        }),
        { headers: authHeaders() }
      );

      rmSync(reportDir, { recursive: true, force: true });
    });

    it('report create: should include manual metrics and disable git auto collection with --no-git', async () => {
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'r2' } } } as any);

      const reportDir = mkdtempSync(join(tmpdir(), 'report-'));
      const reportFile = join(reportDir, 'report.md');
      writeFileSync(reportFile, '# Metric report', 'utf-8');

      await executeCommand('report', 'create', {
        title: 'Metric report',
        file: reportFile,
        git: false,
        commitHash: 'abc123',
        branchName: 'feature/report',
        filesModified: '5',
        linesAdded: '120',
        linesDeleted: '30',
        durationSeconds: '1800',
        commitStart: '111aaa',
        commitEnd: '222bbb',
        pullRequestId: '42',
        qualityScore: '95',
      });

      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports`,
        expect.objectContaining({
          title: 'Metric report',
          content: '# Metric report',
          commitHash: 'abc123',
          branchName: 'feature/report',
          filesModified: 5,
          linesAdded: 120,
          linesDeleted: 30,
          durationSeconds: 1800,
          commitStart: '111aaa',
          commitEnd: '222bbb',
          pullRequestId: '42',
          qualityScore: 95,
        }),
        { headers: authHeaders() }
      );
      rmSync(reportDir, { recursive: true, force: true });
    });


    it('report update: should include metric fields in update body', async () => {
      axiosPutSpy.mockResolvedValue({ data: { data: { id: 'r3' } } } as any);

      await executeCommand('report', 'update', {
        id: 'report-3',
        commitHash: 'fff999',
        branchName: 'main',
        filesModified: '2',
        linesAdded: '10',
        linesDeleted: '4',
        durationSeconds: '90',
        commitStart: 'aaa111',
        commitEnd: 'bbb222',
        pullRequestId: '77',
        qualityScore: '80',
      });

      expect(axiosPutSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports/report-3`,
        expect.objectContaining({
          commitHash: 'fff999',
          branchName: 'main',
          filesModified: 2,
          linesAdded: 10,
          linesDeleted: 4,
          durationSeconds: 90,
          commitStart: 'aaa111',
          commitEnd: 'bbb222',
          pullRequestId: '77',
          qualityScore: 80,
        }),
        { headers: authHeaders() }
      );
    });

    it('report list: should pass query filters and pagination', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);

      await executeCommand('report', 'list', {
        planId: 'plan-1',
        status: 'COMPLETED',
        page: '2',
        pageSize: '10',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports`,
        {
          headers: authHeaders(),
          params: {
            planId: 'plan-1',
            status: 'COMPLETED',
            page: 2,
            pageSize: 10,
          },
        }
      );
    });

    it('report delete: should call project-scoped endpoint without json content-type', async () => {
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      await executeCommand('report', 'delete', { id: 'report-1' });

      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/completion-reports/report-1`,
        { headers: deleteHeaders() }
      );
    });

    it('postmortem command: should remain project-scoped post mortem path', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);
      axiosPostSpy.mockResolvedValue({ data: { data: { id: 'pm1' } } } as any);

      await executeCommand('postmortem', 'list', {});
      await executeCommand('postmortem', 'create', {
        title: 'Title',
        content: 'Content',
        actionItems: 'item1,item2',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/post-mortems`,
        { headers: authHeaders() }
      );
      expect(axiosPostSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/post-mortems`,
        expect.objectContaining({
          title: 'Title',
          content: 'Content',
          actionItems: ['item1', 'item2'],
        }),
        { headers: authHeaders() }
      );
    });


    it('postmortem list: should pass query filters and pagination', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: [] } } as any);

      await executeCommand('postmortem', 'list', {
        planId: 'plan-1',
        status: 'RESOLVED',
        page: '4',
        pageSize: '5',
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/post-mortems`,
        {
          headers: authHeaders(),
          params: {
            planId: 'plan-1',
            status: 'RESOLVED',
            page: 4,
            pageSize: 5,
          },
        }
      );
    });

    it('postmortem delete: should call project-scoped endpoint without json content-type', async () => {
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      await executeCommand('postmortem', 'delete', { id: 'pm-1' });

      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/post-mortems/pm-1`,
        { headers: deleteHeaders() }
      );
    });

    it('agent-config get/delete: should use project-scoped endpoints and delete headers', async () => {
      axiosGetSpy.mockResolvedValue({ data: { data: { id: 'ac-1' } } } as any);
      axiosDeleteSpy.mockResolvedValue({ status: 204 } as any);

      await executeCommand('agent-config', 'get', { id: 'ac-1' });
      await executeCommand('agent-config', 'delete', { id: 'ac-1' });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/agent-configs/ac-1`,
        { headers: authHeaders() }
      );
      expect(axiosDeleteSpy).toHaveBeenCalledWith(
        `${API_URL}/api/projects/${PROJECT_ID}/agent-configs/ac-1`,
        { headers: deleteHeaders() }
      );
    });

    it('config whoami: should display current API key info', async () => {
      const result = await executeCommand('config', 'whoami', {});

      expect(result).toEqual(
        expect.objectContaining({
          apiUrl: API_URL,
          projectId: PROJECT_ID,
          teamId: 'team_1',
          agentName: 'test-agent',
          hasApiKey: true,
        })
      );
    });

    it('should validate required options for updated contracts', async () => {
      await expect(
        executeCommand('plan', 'create', { title: 'no desc' })
      ).rejects.toThrow('--content, --file, or --template is required for plan create');
      await expect(
        executeCommand('comment', 'create', { planId: 'plan-1', content: 'x' })
      ).rejects.toThrow('--type is required for comment create');
      await expect(
        executeCommand('dependency', 'create', { planId: 'plan-1' })
      ).rejects.toThrow('--blocking-plan-id is required for dependency create');
      await expect(executeCommand('convention', 'append', {})).rejects.toThrow(
        'Unknown convention action: append. Use list, show, download, create, update, or delete.'
      );
      await expect(executeCommand('sync', 'list', {})).rejects.toThrow(
        'Unknown sync action: list. Use download.'
      );
    });

    it('CLI definitions: should include new options and remove legacy options', () => {
      const cliIndex = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf-8');

      expect(cliIndex).toContain("--task <text>");
      expect(cliIndex).toContain("--type <type>");
      expect(cliIndex).toContain("--blocking-plan-id <id>");
      expect(cliIndex).toContain("--commit-hash <hash>");
      expect(cliIndex).toContain("--branch-name <name>");
      expect(cliIndex).toContain("--files-modified <n>");
      expect(cliIndex).toContain("--lines-added <n>");
      expect(cliIndex).toContain("--lines-deleted <n>");
      expect(cliIndex).toContain("--duration-seconds <n>");
      expect(cliIndex).toContain("--commit-start <hash>");
      expect(cliIndex).toContain("--commit-end <hash>");
      expect(cliIndex).toContain("--pull-request-id <id>");
      expect(cliIndex).toContain("--quality-score <n>");
      expect(cliIndex).toContain("--no-git");
      expect(cliIndex).toContain(".command('sync')");
      expect(cliIndex).toContain(".command('postmortem')");
      expect(cliIndex).toContain("--search <text>");
      expect(cliIndex).toContain("--assigned-to <id>");
      expect(cliIndex).toContain("--page <number>");
      expect(cliIndex).toContain("--page-size <number>");
      expect(cliIndex).toContain("Action to perform (list, get, show, create");
      expect(cliIndex).toContain("--template <name>");
      expect(cliIndex).toContain("--include-deps");
      expect(cliIndex).not.toContain("Action to perform (download)");

      expect(cliIndex).toContain("--metadata <json>");
      expect(cliIndex).not.toContain("--author-id <id>");
      expect(cliIndex).not.toContain("--depends-on <id>");
      expect(cliIndex).toContain("BACKLOG, TODO, ASSIGNED, IN_PROGRESS, BLOCKED, DONE, CANCELLED");
    });

    it('should throw for unknown resource command', async () => {
      await expect(executeCommand('unknown', 'list', {})).rejects.toThrow(
        'Unknown resource: unknown'
      );
    });

    describe('search', () => {
      it('should call search API with query', async () => {
        axiosGetSpy.mockResolvedValueOnce({
          data: {
            data: [
              { entityType: 'PLAN', id: 'p1', title: 'Test Plan', snippet: 'match', rank: 1, contentTokenCount: 100, createdAt: '2026-01-01T00:00:00Z' },
            ],
            meta: { total: 1, truncatedByTokenBudget: false },
          },
        });

        const result = await executeCommand('search', '', { query: 'test' });
        expect(axiosGetSpy).toHaveBeenCalledWith(
          expect.stringContaining(`/api/projects/${PROJECT_ID}/search?q=test`),
          expect.objectContaining({ headers: authHeaders() })
        );
        expect((result as any).data).toHaveLength(1);
        expect((result as any).data[0].entityType).toBe('PLAN');
      });

      it('should pass types filter as array params', async () => {
        axiosGetSpy.mockResolvedValueOnce({
          data: { data: [], meta: { total: 0, truncatedByTokenBudget: false } },
        });

        await executeCommand('search', '', { query: 'test', types: 'PLAN,CO_ACTION' });
        const calledUrl = axiosGetSpy.mock.calls[0]![0] as string;
        expect(calledUrl).toContain('types%5B%5D=PLAN');
        expect(calledUrl).toContain('types%5B%5D=CO_ACTION');
      });

      it('should throw when query is missing', async () => {
        await expect(executeCommand('search', '', {})).rejects.toThrow('--query is required');
      });

      it('should throw for invalid types', async () => {
        await expect(
          executeCommand('search', '', { query: 'test', types: 'INVALID' })
        ).rejects.toThrow('Invalid type(s): INVALID');
      });

      it('should pass limit and maxTokens', async () => {
        axiosGetSpy.mockResolvedValueOnce({
          data: { data: [], meta: { total: 0, truncatedByTokenBudget: false } },
        });

        await executeCommand('search', '', { query: 'test', limit: '10', maxTokens: '5000' });
        const calledUrl = axiosGetSpy.mock.calls[0]![0] as string;
        expect(calledUrl).toContain('limit=10');
        expect(calledUrl).toContain('maxTokens=5000');
      });
    });
  });

  describe('Output Formatting', () => {
    it('should output JSON by default', () => {
      const data = { id: 1, name: 'test' };
      const output = formatOutput(data, 'json');

      expect(output).toBe(JSON.stringify(data, null, 2));
    });

    it('should output human-friendly text with --format text', () => {
      const data = {
        data: [
          { id: 1, agentName: 'agent1', status: 'IN_PROGRESS' },
          { id: 2, agentName: 'agent2', status: 'DONE' },
        ],
      };

      const output = formatOutput(data, 'text');

      expect(output).toContain('agent1');
      expect(output).toContain('IN_PROGRESS');
      expect(output).toContain('agent2');
      expect(output).toContain('DONE');
    });

    it('should prioritize plan core keys in text output', () => {
      const data = {
        data: {
          updatedAt: '2026-01-01T00:00:00.000Z',
          extra: 'value',
          priority: 'HIGH',
          id: 'plan-1',
          status: 'IN_PROGRESS',
          title: 'My Plan',
        },
      };

      const output = formatOutput(data, 'text');
      const lines = output.split('\n');

      expect(lines[0]).toBe('id: plan-1');
      expect(lines[1]).toBe('title: My Plan');
      expect(lines[2]).toBe('status: IN_PROGRESS');
      expect(lines[3]).toBe('priority: HIGH');
      expect(lines[4]).toBe('updatedAt: 2026-01-01T00:00:00.000Z');
    });
  });

  describe('Error Handling', () => {
    it('400: should display bad request message with next action', () => {
      const error = {
        response: {
          status: 400,
          data: { message: 'Bad Request' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 400',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Bad request');
      expect(errorMessage).toContain('Next:');
      expect(errorMessage).toContain('Details:');
    });

    it('401: should display "Invalid API key" message', () => {
      const error = {
        response: {
          status: 401,
          data: { message: 'Unauthorized' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 401',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Invalid API key');
    });

    it('403 (cross-project): should display "Cross-project access denied" message', () => {
      const error = {
        response: {
          status: 403,
          data: { message: 'Cross-project access denied' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 403',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Cross-project access denied');
    });

    it('403 (errorCode): should prioritize CROSS_PROJECT_ACCESS_DENIED over message matching', () => {
      const error = {
        response: {
          status: 403,
          data: {
            message: '권한 없음',
            errorCode: 'CROSS_PROJECT_ACCESS_DENIED',
          },
        },
        isAxiosError: true,
        message: 'Request failed with status code 403',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Cross-project access denied');
    });

    it('403 (generic): should display "Forbidden" message', () => {
      const error = {
        response: {
          status: 403,
          data: { message: '컨벤션 수정 권한이 없습니다' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 403',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Forbidden.');
      expect(errorMessage).toContain("You don't have permission to modify conventions.");
    });

    it('Network error: should display "Cannot connect" message', () => {
      const error = {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED',
        isAxiosError: true,
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Cannot connect to server');
    });

    it('404: should display resource not found message', () => {
      const error = {
        response: {
          status: 404,
          data: { message: 'Not Found' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 404',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Resource not found');
    });

    it('409: should display conflict message with next action', () => {
      const error = {
        response: {
          status: 409,
          data: { message: 'Conflict' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 409',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Conflict');
      expect(errorMessage).toContain('Next:');
      expect(errorMessage).toContain('Details:');
    });

    it('409 (errorCode): should display optimistic lock guidance', () => {
      const error = {
        response: {
          status: 409,
          data: {
            message: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요',
            errorCode: 'OPTIMISTIC_LOCK_CONFLICT',
          },
        },
        isAxiosError: true,
        message: 'Request failed with status code 409',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Conflict (stale update)');
      expect(errorMessage).toContain('convention download');
    });

    it('400 (errorCode): should display validation guidance', () => {
      const error = {
        response: {
          status: 400,
          data: {
            message: 'projectId 파라미터가 필요합니다',
            errorCode: 'VALIDATION_ERROR',
          },
        },
        isAxiosError: true,
        message: 'Request failed with status code 400',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Bad request (validation)');
      expect(errorMessage).toContain('request parameters');
    });

    it('500: should display server error message', () => {
      const error = {
        response: {
          status: 500,
          data: { message: 'Internal Server Error' },
        },
        isAxiosError: true,
        message: 'Request failed with status code 500',
      } as AxiosError;

      const errorMessage = handleError(error);
      expect(errorMessage).toContain('Server error');
    });
  });
});
