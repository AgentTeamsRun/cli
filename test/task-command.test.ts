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
