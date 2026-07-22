import { executeInitCommand } from './init.js';
import { executeDoctorCommand } from './doctor.js';
import { executeAgentConfigCommand } from './agentConfigCommand.js';
import { executeConfigCommand } from './config.js';
import { executeConventionCommand, executeSyncCommand } from './conventionRouter.js';
import { executeDocumentCommand } from './document.js';
import { executeDependencyCommand } from './dependencyCommand.js';
import { executeCommentCommand } from './comment.js';
import { executePlanCommand } from './plan.js';
import { executePostMortemCommand } from './postmortem.js';
import { executeCoActionCommand } from './coaction.js';
import { executeReportCommand } from './report.js';
import { executeCodeReviewCommand } from './codeReview.js';
import { executeChangeSetCommand } from './changeSetCommand.js';
import { executeFeedbackCommand } from './feedback.js';
import { executeSearchCommand } from './search.js';
import { executeLinearCommand } from './linear.js';
import { executeAttachmentCommand } from './attachment.js';
import { executeTaskCommand } from './task.js';
import { getConfigurationNotFoundMessage, loadConfig } from '../utils/config.js';
import { executeWorktreeCommand } from './worktree.js';
import { normalizeCommandContext, withCommandContext } from '../utils/commandContext.js';
import { normalizeEntityIdOptions } from '../utils/entityId.js';
import { attachErrorContext } from '../utils/errors.js';
const CONFIG_OVERRIDE_KEYS = ['apiKey', 'apiUrl', 'teamId', 'projectId'];
function buildConfigOverrides(options) {
    const overrides = {};
    for (const key of CONFIG_OVERRIDE_KEYS) {
        const value = options[key];
        if (typeof value === 'string' && value.length > 0) {
            overrides[key] = value;
        }
    }
    return overrides;
}
function loadRequiredConfig(overrides) {
    const config = loadConfig(overrides);
    if (!config) {
        throw new Error(getConfigurationNotFoundMessage());
    }
    return config;
}
function resolveApiContext(config) {
    const apiUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;
    const headers = {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
    };
    return { apiUrl, headers };
}
async function withApiErrorContext(apiUrl, operation) {
    try {
        return await operation();
    }
    catch (error) {
        throw attachErrorContext(error, { apiUrl });
    }
}
export async function executeCommand(resource, action, options) {
    // Accept prefixed entity ids (e.g. `agentteams_pln_<uuid>`) pasted from web
    // UI references by normalizing them to bare ids before any command runs.
    const normalizedOptions = normalizeEntityIdOptions(options);
    return withCommandContext(normalizeCommandContext(resource, action), () => executeCommandWithContext(resource, action, normalizedOptions));
}
async function executeCommandWithContext(resource, action, options) {
    switch (resource) {
        case 'init':
            return executeInitCommand(options);
        case 'worktree':
            return executeWorktreeCommand(action, options);
        // Local diagnosis/repair resource: must stay routable without loading the
        // project config or API context first.
        case 'doctor':
            return executeDoctorCommand(options);
        case 'convention':
            return executeConventionCommand(action, options);
        case 'sync':
            return executeSyncCommand(action, options);
        case 'plan':
        case 'task':
        case 'comment': {
            const config = loadRequiredConfig();
            const { apiUrl, headers } = resolveApiContext(config);
            if (resource === 'plan') {
                return withApiErrorContext(apiUrl, () => executePlanCommand(apiUrl, config.projectId, headers, action, options));
            }
            if (resource === 'task') {
                return withApiErrorContext(apiUrl, () => executeTaskCommand(apiUrl, config.projectId, headers, action, options));
            }
            if (resource === 'comment') {
                return withApiErrorContext(apiUrl, () => executeCommentCommand(apiUrl, config.projectId, headers, action, options));
            }
            throw new Error(`Unknown resource: ${resource}`);
        }
        case 'document': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeDocumentCommand(apiUrl, config.projectId, headers, action, options));
        }
        case 'report': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeReportCommand(apiUrl, headers, action, {
                ...options,
                projectId: config.projectId,
            }));
        }
        case 'code-review': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeCodeReviewCommand(apiUrl, config.projectId, headers, action, {
                ...options,
                projectId: config.projectId,
            }));
        }
        case 'change-set': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeChangeSetCommand({ apiUrl, projectId: config.projectId, headers }, action, options));
        }
        case 'postmortem': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executePostMortemCommand(apiUrl, headers, action, {
                ...options,
                projectId: config.projectId,
            }));
        }
        case 'coaction': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeCoActionCommand(apiUrl, headers, action, {
                ...options,
                projectId: config.projectId,
            }));
        }
        case 'dependency':
            return executeDependencyCommand(action, options);
        case 'feedback': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeFeedbackCommand(apiUrl, headers, action, options));
        }
        case 'agent-config':
            return executeAgentConfigCommand(action, options);
        case 'config':
            return executeConfigCommand(action);
        case 'search': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeSearchCommand(apiUrl, config.projectId, headers, options));
        }
        case 'linear': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeLinearCommand(apiUrl, headers, action, options));
        }
        case 'attachment': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeAttachmentCommand(apiUrl, headers, action, options));
        }
        default:
            throw new Error(`Unknown resource: ${resource}`);
    }
}
//# sourceMappingURL=index.js.map