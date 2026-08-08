import { executeInitCommand } from './init.js';
import { executeAuthCommand } from './auth.js';
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
import { executeResolveCommand } from './resolve.js';
import { getConfigurationNotFoundMessage, loadConfigWithCredential } from '../utils/config.js';
import { executeWorktreeCommand } from './worktree.js';
import { normalizeCommandContext, withCommandContext } from '../utils/commandContext.js';
import { normalizeEntityIdOptions } from '../utils/entityId.js';
import { attachErrorContext } from '../utils/errors.js';
import { buildConfigOverrides, resolveApiContext } from '../utils/apiContext.js';
import type { Config } from '../types/index.js';

async function loadRequiredConfig(overrides?: Partial<Config>): Promise<Config> {
  const config = await loadConfigWithCredential(overrides);
  if (!config) {
    throw new Error(getConfigurationNotFoundMessage());
  }
  return config;
}

async function withApiErrorContext<T>(apiUrl: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw attachErrorContext(error, { apiUrl });
  }
}

export async function executeCommand(
  resource: string,
  action: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  // Accept prefixed entity ids (e.g. `agentteams_pln_<uuid>`) pasted from web
  // UI references by normalizing them to bare ids before any command runs.
  const normalizedOptions = normalizeEntityIdOptions(options);
  return withCommandContext(normalizeCommandContext(resource, action), () =>
    executeCommandWithContext(resource, action, normalizedOptions),
  );
}

async function executeCommandWithContext(
  resource: string,
  action: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  switch (resource) {
    case 'init':
      return executeInitCommand(options);
    // Authentication is what produces a credential, so it must stay routable
    // before any credential can be resolved.
    case 'auth':
      return executeAuthCommand(action, options);
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
      const config = await loadRequiredConfig();
      const { apiUrl, headers } = resolveApiContext(config);

      if (resource === 'plan') {
        return withApiErrorContext(apiUrl, () =>
          executePlanCommand(apiUrl, config.projectId, headers, action, options),
        );
      }

      if (resource === 'task') {
        return withApiErrorContext(apiUrl, () =>
          executeTaskCommand(apiUrl, config.projectId, headers, action, options),
        );
      }

      if (resource === 'comment') {
        return withApiErrorContext(apiUrl, () =>
          executeCommentCommand(apiUrl, config.projectId, headers, action, options),
        );
      }

      throw new Error(`Unknown resource: ${resource}`);
    }
    case 'document': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () =>
        executeDocumentCommand(apiUrl, config.projectId, headers, action, options),
      );
    }
    case 'report': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);

      return withApiErrorContext(apiUrl, () =>
        executeReportCommand(apiUrl, headers, action, {
          ...options,
          projectId: config.projectId,
        }),
      );
    }
    case 'code-review': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () =>
        executeCodeReviewCommand(apiUrl, config.projectId, headers, action, {
          ...options,
          projectId: config.projectId,
        }),
      );
    }
    case 'change-set': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () =>
        executeChangeSetCommand({ apiUrl, projectId: config.projectId, headers }, action, options),
      );
    }
    case 'postmortem': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);

      return withApiErrorContext(apiUrl, () =>
        executePostMortemCommand(apiUrl, headers, action, {
          ...options,
          projectId: config.projectId,
        }),
      );
    }
    case 'coaction': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () =>
        executeCoActionCommand(apiUrl, headers, action, {
          ...options,
          projectId: config.projectId,
        }),
      );
    }
    // Entity-reference resolution. The API context is loaded lazily because
    // external markers and local convention paths resolve without a project
    // config or any network access.
    case 'resolve': {
      let resolvedApiUrl: string | null = null;
      const loadContext = async () => {
        const config = await loadRequiredConfig(buildConfigOverrides(options));
        const { apiUrl, headers } = resolveApiContext(config);
        resolvedApiUrl = apiUrl;
        return { apiUrl, projectId: config.projectId, headers };
      };

      try {
        return await executeResolveCommand(options, loadContext);
      } catch (error) {
        throw resolvedApiUrl ? attachErrorContext(error, { apiUrl: resolvedApiUrl }) : error;
      }
    }
    case 'dependency':
      return executeDependencyCommand(action, options);
    case 'feedback': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () => executeFeedbackCommand(apiUrl, headers, action, options));
    }
    case 'agent-config':
      return executeAgentConfigCommand(action, options);
    case 'config':
      return executeConfigCommand(action);
    case 'search': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () => executeSearchCommand(apiUrl, config.projectId, headers, options));
    }
    case 'linear': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () =>
        executeLinearCommand(apiUrl, config.projectId, headers, action, options),
      );
    }
    case 'attachment': {
      const config = await loadRequiredConfig(buildConfigOverrides(options));
      const { apiUrl, headers } = resolveApiContext(config);
      return withApiErrorContext(apiUrl, () => executeAttachmentCommand(apiUrl, headers, action, options));
    }
    default:
      throw new Error(`Unknown resource: ${resource}`);
  }
}
