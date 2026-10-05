import { describe, it, expect, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import axios from 'axios';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTaskCommand } from '../src/commands/task.js';

const apiUrl = 'http://localhost:3001';
const projectId = 'project-1';
const headers = { 'X-API-Key': 'key', 'Content-Type': 'application/json' };

describe('task lifecycle commands', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gets one focused task via the child-only endpoint narrowed by planId, stripping entity prefixes', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        data: {
          task: { id: 'task-1', number: 1, title: 'Task A', detail: 'do A', dependsOnTaskIds: [] },
          plan: { id: 'plan-1', title: 'Plan', status: 'IN_PROGRESS' },
        },
      },
    } as never);

    const result = await executeTaskCommand(apiUrl, projectId, headers, 'get', {
      planId: 'agentteams_pln_plan-1',
      taskId: 'agentteams_tsk_task-1',
    });

    expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/plans/tasks/task-1`, {
      headers,
      params: { planId: 'plan-1' },
    });
    expect(result).toMatchObject({
      data: {
        task: { id: 'task-1', title: 'Task A' },
        plan: { id: 'plan-1', title: 'Plan' },
      },
    });
  });

  it('gets one focused task from a bare task-id token without a parent plan-id', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        data: {
          task: { id: 'task-1', number: 2, title: 'Task B', detail: 'do B', dependsOnTaskIds: [] },
          plan: { id: 'plan-1', title: 'Plan', status: 'IN_PROGRESS' },
        },
      },
    } as never);

    const result = await executeTaskCommand(apiUrl, projectId, headers, 'get', {
      taskId: 'agentteams_tsk_task-1',
    });

    expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/plans/tasks/task-1`, { headers });
    expect(result).toMatchObject({
      data: {
        task: { id: 'task-1', title: 'Task B' },
        plan: { id: 'plan-1', title: 'Plan' },
      },
    });
  });

  it('starts a task through the task lifecycle endpoint', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null } },
    } as never);

    const result = await executeTaskCommand(apiUrl, projectId, headers, 'start', {
      planId: 'plan-1',
      taskId: 'task-1',
    });

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/start`,
      {},
      { headers },
    );
    expect(result).toMatchObject({ message: 'Task started (task-1)', planId: 'plan-1', taskId: 'task-1' });
  });

  it('validates task finish status before calling the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');

    await expect(
      executeTaskCommand(apiUrl, projectId, headers, 'finish', {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'TODO',
      }),
    ).rejects.toThrow('--status must be one of DONE, BLOCKED, or SKIPPED');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('finishes a task through the task lifecycle endpoint', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'PARTIAL', tasks: [], progress: null } },
    } as never);

    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'done',
      },
      { collectTaskFinishGitSnapshot: () => null },
    );

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/finish`,
      { status: 'DONE' },
      { headers },
    );
    expect(result).toMatchObject({
      message: 'Task finished (task-1: DONE)',
      planId: 'plan-1',
      taskId: 'task-1',
      status: 'DONE',
    });
  });

  it('includes a git snapshot and warns when HEAD is not on any remote branch', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null } },
    } as never);
    const git = {
      commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      branch: 'feat/unpushed',
      commitOnRemote: false,
    };

    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
      },
      { collectTaskFinishGitSnapshot: () => git },
    );

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/finish`,
      { status: 'DONE', git },
      { headers },
    );
    expect(result).toMatchObject({
      warning: 'HEAD commit is not on any remote branch. Push before another runner continues this plan.',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Warning: HEAD commit is not on any remote branch. Push before another runner continues this plan.',
    );
  });

  it('warns on BLOCKED finish when HEAD is not on any remote branch', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null } },
    } as never);
    const git = {
      commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      branch: 'feat/blocked',
      commitOnRemote: false,
    };

    await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'BLOCKED',
      },
      { collectTaskFinishGitSnapshot: () => git },
    );

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/finish`,
      { status: 'BLOCKED', git },
      { headers },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Warning: HEAD commit is not on any remote branch. Push before another runner continues this plan.',
    );
  });

  it('omits git from the request body when --no-git is set', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const collect = jest.fn(() => ({
      commit: 'cccccccccccccccccccccccccccccccccccccccc',
      branch: 'feat/ignored',
      commitOnRemote: false,
    }));
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null } },
    } as never);

    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
        git: false,
      },
      { collectTaskFinishGitSnapshot: collect },
    );

    expect(collect).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/finish`,
      { status: 'DONE' },
      { headers },
    );
    expect(result).not.toHaveProperty('warning');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('succeeds without a git field when the working directory is not a git repository', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null } },
    } as never);

    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
      },
      { collectTaskFinishGitSnapshot: () => null },
    );

    expect(postSpy).toHaveBeenCalledWith(
      `${apiUrl}/api/projects/${projectId}/plans/plan-1/tasks/task-1/finish`,
      { status: 'DONE' },
      { headers },
    );
    expect(result).toMatchObject({ message: 'Task finished (task-1: DONE)', status: 'DONE' });
  });
});

describe('task finish --report-file', () => {
  const reportContent = '## Summary\n\nTask report body that is long enough for the server minimum.';
  const git = { commit: 'dddddddddddddddddddddddddddddddddddddddd', branch: 'feat/task-report', commitOnRemote: true };
  let dir = '';
  let reportPath = '';
  let emptyPath = '';
  let tempDir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'task-report-'));
    reportPath = join(dir, 'report.md');
    emptyPath = join(dir, 'empty.md');
    tempDir = join(dir, '.agentteams', 'cli', 'temp');
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(reportPath, reportContent);
    writeFileSync(emptyPath, '   \n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const finishDeps = (overrides: Record<string, unknown> = {}) => ({
    collectTaskFinishGitSnapshot: () => git,
    collectGitMetrics: jest.fn(() => ({ commitHash: git.commit, filesModified: 3, linesAdded: 10, linesDeleted: 2 })),
    getGitRemoteOriginUrl: () => 'git@github.com:acme/repo.git',
    env: {},
    ...overrides,
  });

  const mockFinish = () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    return jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          planStatus: 'IN_PROGRESS',
          tasks: [],
          progress: null,
          completionReport: {
            id: 'report-1',
            title: 'Task 1. Task A',
            status: 'PARTIAL',
            webUrl: 'https://agentteams.run/go?type=completion-report&id=report-1',
          },
        },
      },
    } as never);
  };

  const finishBody = (postSpy: ReturnType<typeof mockFinish>) =>
    (postSpy.mock.calls[0] as unknown[])[1] as Record<string, any>;

  it('keeps the report-less body unchanged', async () => {
    const postSpy = mockFinish();
    await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      { planId: 'plan-1', taskId: 'task-1', status: 'DONE', runnerType: 'CLAUDE_CODE', model: 'claude-opus-5-5' },
      finishDeps(),
    );
    expect(finishBody(postSpy)).toEqual({ status: 'DONE', git });
  });

  it('derives the report status from the task status instead of sending the task status', async () => {
    const postSpy = mockFinish();
    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'BLOCKED',
        reportFile: reportPath,
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-5-5',
      },
      finishDeps(),
    );
    const body = finishBody(postSpy);
    expect(body.status).toBe('BLOCKED');
    expect(body.completionReport.status).toBe('PARTIAL');
    expect(body.completionReport).toMatchObject({
      content: reportContent,
      commitHash: git.commit,
      branchName: git.branch,
      repositoryRemoteUrl: 'git@github.com:acme/repo.git',
    });
    expect(body.completionReport).not.toHaveProperty('title');
    expect(body).toMatchObject({ runnerType: 'CLAUDE_CODE', model: 'claude-opus-5-5' });
    expect(result).toMatchObject({ webUrl: 'https://agentteams.run/go?type=completion-report&id=report-1' });
  });

  it('passes an explicit --report-status and --report-title through', async () => {
    const postSpy = mockFinish();
    await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
        reportFile: reportPath,
        reportStatus: 'FAILED',
        reportTitle: 'Custom title',
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-5-5',
      },
      finishDeps(),
    );
    expect(finishBody(postSpy).completionReport).toMatchObject({ status: 'FAILED', title: 'Custom title' });
  });

  it('requires runner-type and model when no session environment provides them', async () => {
    const postSpy = jest.spyOn(axios, 'post');
    await expect(
      executeTaskCommand(
        apiUrl,
        projectId,
        headers,
        'finish',
        { planId: 'plan-1', taskId: 'task-1', status: 'DONE', reportFile: reportPath },
        finishDeps(),
      ),
    ).rejects.toThrow('In a runner session these are filled in automatically from the environment.');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('falls back to the runner session environment for runner-type and model', async () => {
    const postSpy = mockFinish();
    await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      { planId: 'plan-1', taskId: 'task-1', status: 'DONE', reportFile: reportPath },
      finishDeps({ env: { AGENTTEAMS_RUNNER_TYPE: 'CODEX', AGENTTEAMS_MODEL: 'gpt-6-astra' } }),
    );
    expect(finishBody(postSpy)).toMatchObject({ runnerType: 'CODEX', model: 'gpt-6-astra' });
  });

  it('rejects a missing or empty report file before calling the API', async () => {
    const postSpy = jest.spyOn(axios, 'post');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const base = { planId: 'plan-1', taskId: 'task-1', status: 'DONE', runnerType: 'CLAUDE_CODE', model: 'm' };
    await expect(
      executeTaskCommand(
        apiUrl,
        projectId,
        headers,
        'finish',
        { ...base, reportFile: join(dir, 'nope.md') },
        finishDeps(),
      ),
    ).rejects.toThrow('File not found');
    await expect(
      executeTaskCommand(apiUrl, projectId, headers, 'finish', { ...base, reportFile: emptyPath }, finishDeps()),
    ).rejects.toThrow('Report file is empty.');
    await expect(
      executeTaskCommand(apiUrl, projectId, headers, 'finish', { ...base, reportFile: '  ' }, finishDeps()),
    ).rejects.toThrow('--report-file requires a non-empty path');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('collects line and file counts only when --commit-start is given', async () => {
    const postSpy = mockFinish();
    const deps = finishDeps();
    const base = {
      planId: 'plan-1',
      taskId: 'task-1',
      status: 'DONE',
      reportFile: reportPath,
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-5-5',
    };

    await executeTaskCommand(apiUrl, projectId, headers, 'finish', base, deps);
    const withoutStart = finishBody(postSpy).completionReport;
    expect(withoutStart).not.toHaveProperty('linesAdded');
    expect(withoutStart).not.toHaveProperty('linesDeleted');
    expect(withoutStart).not.toHaveProperty('filesModified');
    expect(withoutStart).not.toHaveProperty('commitStart');
    expect(deps.collectGitMetrics).not.toHaveBeenCalled();

    await executeTaskCommand(apiUrl, projectId, headers, 'finish', { ...base, commitStart: 'abc123' }, deps);
    const withStart = ((postSpy.mock.calls[1] as unknown[])[1] as Record<string, any>).completionReport;
    expect(deps.collectGitMetrics).toHaveBeenCalledWith(undefined, { startCommit: 'abc123' });
    expect(withStart).toMatchObject({ commitStart: 'abc123', filesModified: 3, linesAdded: 10, linesDeleted: 2 });
  });

  it.each([
    { scenario: 'missing-report', completionReport: undefined },
    {
      scenario: 'url-without-id',
      completionReport: {
        title: 'Task 1. Task A',
        webUrl: 'https://agentteams.run/go?type=completion-report&id=report-1',
      },
    },
  ])(
    'preserves the temp report and shows its path when creation is not confirmed: $scenario',
    async ({ scenario, completionReport }) => {
      const tempReportPath = join(tempDir, `${scenario}.md`);
      writeFileSync(tempReportPath, reportContent);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(axios, 'post').mockResolvedValue({
        data: { data: { planStatus: 'IN_PROGRESS', tasks: [], progress: null, completionReport } },
      } as never);

      const result = await executeTaskCommand(
        apiUrl,
        projectId,
        headers,
        'finish',
        {
          planId: 'plan-1',
          taskId: 'task-1',
          status: 'DONE',
          reportFile: tempReportPath,
          runnerType: 'CLAUDE_CODE',
          model: 'claude-opus-5-5',
        },
        finishDeps(),
      );

      expect(result).not.toHaveProperty('webUrl');
      expect(existsSync(tempReportPath)).toBe(true);
      expect(readFileSync(tempReportPath, 'utf-8')).toBe(reportContent);
      expect(result).toMatchObject({
        warning: expect.stringContaining(`The report file was preserved at: ${tempReportPath}`),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`The report file was preserved at: ${tempReportPath}`),
      );
    },
  );

  it('deletes the temp report after the server confirms report creation', async () => {
    mockFinish();
    const tempReportPath = join(tempDir, 'created.md');
    writeFileSync(tempReportPath, reportContent);

    const result = await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
        reportFile: tempReportPath,
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-5-5',
      },
      finishDeps(),
    );

    expect(existsSync(tempReportPath)).toBe(false);
    expect(result).toMatchObject({ webUrl: 'https://agentteams.run/go?type=completion-report&id=report-1' });
    expect(result).not.toHaveProperty('warning');
  });

  it('preserves the temp report after creation when --keep-temp is set', async () => {
    mockFinish();
    const tempReportPath = join(tempDir, 'keep.md');
    writeFileSync(tempReportPath, reportContent);

    await executeTaskCommand(
      apiUrl,
      projectId,
      headers,
      'finish',
      {
        planId: 'plan-1',
        taskId: 'task-1',
        status: 'DONE',
        reportFile: tempReportPath,
        keepTemp: true,
        runnerType: 'CLAUDE_CODE',
        model: 'claude-opus-5-5',
      },
      finishDeps(),
    );

    expect(existsSync(tempReportPath)).toBe(true);
    expect(readFileSync(tempReportPath, 'utf-8')).toBe(reportContent);
  });
});
