import { executeInitCommand } from './init.js';
import { executeAgentConfigCommand } from './agentConfigCommand.js';
import { executeConfigCommand } from './config.js';
import { executeConventionCommand, executeSyncCommand } from './conventionRouter.js';
import { executeDependencyCommand } from './dependencyCommand.js';
import { executeCommentCommand } from './comment.js';
import { executePlanCommand } from './plan.js';
import { executePostMortemCommand } from './postmortem.js';
import { executeCoActionCommand } from './coaction.js';
import { executeReportCommand } from './report.js';
import { executeFeedbackCommand } from './feedback.js';
import { executeSearchCommand } from './search.js';
import { executeLinearCommand } from './linear.js';
import { loadConfig } from '../utils/config.js';
import { attachErrorContext } from '../utils/errors.js';
const CONFIG_OVERRIDE_KEYS = ['apiKey', 'apiUrl', 'teamId', 'projectId', 'agentName'];
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
        throw new Error("Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.");
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
    switch (resource) {
        case 'init':
            return executeInitCommand(options);
        case 'convention':
            return executeConventionCommand(action, options);
        case 'sync':
            return executeSyncCommand(action, options);
        case 'plan':
        case 'comment':
            {
                const config = loadRequiredConfig();
                const { apiUrl, headers } = resolveApiContext(config);
                if (resource === 'plan') {
                    return withApiErrorContext(apiUrl, () => executePlanCommand(apiUrl, config.projectId, headers, action, {
                        ...options,
                        defaultCreatedBy: config.agentName,
                        defaultRepositoryId: config.repositoryId,
                    }));
                }
                if (resource === 'comment') {
                    return withApiErrorContext(apiUrl, () => executeCommentCommand(apiUrl, config.projectId, headers, action, options));
                }
                throw new Error(`Unknown resource: ${resource}`);
            }
        case 'report': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executeReportCommand(apiUrl, headers, action, {
                ...options,
                projectId: config.projectId,
                defaultCreatedBy: config.agentName,
                defaultRepositoryId: config.repositoryId,
            }));
        }
        case 'postmortem': {
            const config = loadRequiredConfig(buildConfigOverrides(options));
            const { apiUrl, headers } = resolveApiContext(config);
            return withApiErrorContext(apiUrl, () => executePostMortemCommand(apiUrl, headers, action, {
                ...options,
                projectId: config.projectId,
                defaultCreatedBy: config.agentName,
                defaultRepositoryId: config.repositoryId,
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
        default:
            throw new Error(`Unknown resource: ${resource}`);
    }
}
//# sourceMappingURL=index.js.map