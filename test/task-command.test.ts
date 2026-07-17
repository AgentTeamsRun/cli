import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
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

    const result = await executeTaskCommand(apiUrl, projectId, headers, 'finish', {
      planId: 'plan-1',
      taskId: 'task-1',
      status: 'done',
    });

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
});
