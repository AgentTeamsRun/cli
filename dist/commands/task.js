import { finishPlanTask, getPlanTask, startPlanTask } from '../api/task.js';
import { stripEntityIdPrefix } from '../utils/entityId.js';
const FINISH_STATUSES = new Set(['DONE', 'BLOCKED', 'SKIPPED']);
const toNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const toResultObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export async function executeTaskCommand(apiUrl, projectId, headers, action, options) {
    const planId = stripEntityIdPrefix(toNonEmptyString(options.planId));
    const taskId = stripEntityIdPrefix(toNonEmptyString(options.taskId));
    if (!taskId)
        throw new Error('--task-id is required for task commands');
    // get/show(단건 포커스)는 bare agentteams_tsk_<id> 핸드오프를 지원하므로 --plan-id가 선택이다.
    // 있으면 부모 일치로 좁힌다. 실행 뮤테이션(start/finish)은 부모 planId가 필수다.
    if (action === 'get' || action === 'show') {
        return getPlanTask(apiUrl, projectId, headers, taskId, planId);
    }
    if (!planId)
        throw new Error('--plan-id is required for task commands');
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
            if (!status)
                throw new Error('--status is required for task finish');
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
            throw new Error('Unknown task action: ' + action + '. Use get, start, or finish.');
    }
}
//# sourceMappingURL=task.js.map