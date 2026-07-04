import { finishPlanTask, startPlanTask } from '../api/task.js';

const FINISH_STATUSES = new Set(['DONE', 'BLOCKED', 'SKIPPED']);

const toNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const toResultObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export async function executeTaskCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  const planId = toNonEmptyString(options.planId);
  if (!planId) throw new Error('--plan-id is required for task commands');

  const taskId = toNonEmptyString(options.taskId);
  if (!taskId) throw new Error('--task-id is required for task commands');

  switch (action) {
    case 'start': {
      const result = await startPlanTask(apiUrl, projectId, headers, planId, taskId);
      return {
        message: `Task started (${taskId})`,
        planId,
        taskId,
        ...toResultObject(result),
      };
    }
    case 'finish': {
      const status = toNonEmptyString(options.status)?.toUpperCase();
      if (!status) throw new Error('--status is required for task finish');
      if (!FINISH_STATUSES.has(status)) {
        throw new Error('--status must be one of DONE, BLOCKED, or SKIPPED for task finish');
      }

      const result = await finishPlanTask(apiUrl, projectId, headers, planId, taskId, status);
      return {
        message: `Task finished (${taskId}: ${status})`,
        planId,
        taskId,
        status,
        ...toResultObject(result),
      };
    }
    default:
      throw new Error('Unknown task action: ' + action + '. Use start or finish.');
  }
}
