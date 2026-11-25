import { getSchedule, listScheduleRuns, listSchedules } from '../api/schedule.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
function parsePageValue(value, flag) {
    if (value === undefined)
        return undefined;
    const parsed = toPositiveInteger(value);
    if (parsed === undefined || !Number.isSafeInteger(parsed)) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
function schedulePagination(options) {
    const page = parsePageValue(options.page, '--page');
    const pageSize = parsePageValue(options.pageSize, '--page-size');
    return {
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
    };
}
export async function executeScheduleCommand(action, options, withContext) {
    switch (action) {
        case 'list': {
            const params = schedulePagination(options);
            return withContext(({ apiUrl, projectId, headers }) => listSchedules(apiUrl, projectId, headers, params));
        }
        case 'get':
        case 'runs': {
            const id = toNonEmptyString(options.id);
            if (id === undefined)
                throw new Error(`--id is required for schedule ${action}`);
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
//# sourceMappingURL=schedule.js.map