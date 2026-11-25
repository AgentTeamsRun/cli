import { getSchedule, listScheduleRuns, listSchedules, type SchedulePagination } from '../api/schedule.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';

type ScheduleContext = {
  apiUrl: string;
  projectId: string;
  headers: Record<string, string>;
};

function parsePageValue(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;

  const parsed = toPositiveInteger(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function schedulePagination(options: Record<string, unknown>): SchedulePagination {
  const page = parsePageValue(options.page, '--page');
  const pageSize = parsePageValue(options.pageSize, '--page-size');
  return {
    ...(page !== undefined ? { page } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
  };
}

export async function executeScheduleCommand(
  action: string,
  options: Record<string, unknown>,
  withContext: (operation: (context: ScheduleContext) => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
  switch (action) {
    case 'list': {
      const params = schedulePagination(options);
      return withContext(({ apiUrl, projectId, headers }) => listSchedules(apiUrl, projectId, headers, params));
    }
    case 'get':
    case 'runs': {
      const id = toNonEmptyString(options.id);
      if (id === undefined) throw new Error(`--id is required for schedule ${action}`);

      if (action === 'get') {
        return withContext(({ apiUrl, projectId, headers }) => getSchedule(apiUrl, projectId, headers, id));
      }

      const params = schedulePagination(options);
      return withContext(({ apiUrl, projectId, headers }) => listScheduleRuns(apiUrl, projectId, headers, id, params));
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
