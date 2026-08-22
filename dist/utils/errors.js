import { isAxiosError } from 'axios';
import { getActiveCredential, getInjectedPersonalTokenRefreshBlockReason, } from '../auth/activeCredential.js';
function translateServerMessage(message) {
    const mapping = [
        { match: '컨벤션 수정 권한이 없습니다', translated: "You don't have permission to modify conventions." },
        { match: '프로젝트 접근 권한이 없습니다', translated: "You don't have permission to access this project." },
        { match: '인증 토큰이 필요합니다', translated: 'Authentication token is required.' },
        { match: 'projectId 파라미터가 필요합니다', translated: 'projectId parameter is required.' },
    ];
    for (const item of mapping) {
        if (message.includes(item.match)) {
            return item.translated;
        }
    }
    return message;
}
function getErrorContext(error, context) {
    if (context) {
        return context;
    }
    if (error && typeof error === 'object' && 'agentteamsContext' in error) {
        const candidate = error.agentteamsContext;
        if (candidate && typeof candidate === 'object') {
            return candidate;
        }
    }
    return undefined;
}
export function attachErrorContext(error, context) {
    if (!error || typeof error !== 'object') {
        return error;
    }
    const nextContext = {
        ...(error.agentteamsContext ?? {}),
        ...context,
    };
    error.agentteamsContext = nextContext;
    return error;
}
function formatUpgradeRequiredMessage(options) {
    const { message, minimumVersion } = options;
    const lines = [
        'Your AgentTeams CLI version is no longer supported.',
        'Next: Upgrade to the latest CLI and retry.',
        '  npm install -g @agentteams/cli@latest',
    ];
    if (minimumVersion) {
        lines.push(`Minimum supported version: ${minimumVersion}`);
    }
    lines.push('Verify:', '  agentteams --version', 'If the version is still old after upgrade, you may have multiple installs — check with:', '  which -a agentteams');
    if (message) {
        lines.push(`Details: ${message}`);
    }
    return lines.join('\n');
}
function formatInjectedPersonalToken401(reason, details) {
    switch (reason) {
        case 'CLI_CREDENTIAL_MISSING':
            return `The personal token injected by AgentTeams Desktop expired, and no CLI login is available to refresh it.
Next: Run 'agentteams auth login' with the same account used in AgentTeams Desktop, then restart the Desktop agent session.
Details: ${details}`;
        case 'IDENTITY_MISMATCH':
            return `The AgentTeams Desktop session and stored CLI login belong to different members, so automatic refresh was blocked.
Next: Run 'agentteams auth login' with the same account used in AgentTeams Desktop, then restart the Desktop agent session.
Details: ${details}`;
        case 'IDENTITY_MISSING':
            return `The personal token injected by AgentTeams Desktop expired, but its member identity was not provided, so automatic refresh was blocked.
Next: Update or restart AgentTeams Desktop, then start a new agent session.
Details: ${details}`;
        case 'CLI_CREDENTIAL_UNAVAILABLE':
            return `The personal token injected by AgentTeams Desktop expired, and the stored CLI login could not be refreshed.
Next: Check the network, retry, or run 'agentteams auth login' with the same Desktop account, then restart the Desktop agent session.
Details: ${details}`;
    }
}
export function handleError(error, context) {
    const resolvedContext = getErrorContext(error, context);
    if (isAxiosError(error)) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            const rawMessage = typeof data?.message === 'string' ? data.message : error.message;
            const message = typeof rawMessage === 'string' ? translateServerMessage(rawMessage) : String(rawMessage);
            const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
            const errorDetailCode = typeof data?.errorDetailCode === 'string' ? data.errorDetailCode : undefined;
            const minimumVersion = typeof data?.minimumVersion === 'string' ? data.minimumVersion : undefined;
            if (status === 426 || errorCode === 'CLI_UPGRADE_REQUIRED') {
                return formatUpgradeRequiredMessage({ message, minimumVersion });
            }
            switch (status) {
                case 400:
                    if (errorCode === 'VALIDATION_ERROR') {
                        return `Bad request (validation).
Next: Verify required options (e.g., --id/--plan-id) and request parameters.
Details: ${message}`;
                    }
                    return `Bad request. Check your flags and payload.\nNext: Verify required options (e.g., --id/--plan-id) and try again.\nDetails: ${message}`;
                case 401: {
                    // An agent key that ran out its 30-day TTL is not a wrong key, and telling
                    // someone to check AGENTTEAMS_API_KEY sends them looking at a value that is
                    // exactly right. This is the only signal a runner gets, so it has to name
                    // the cause and the fix.
                    if (errorDetailCode === 'AGENT_API_KEY_EXPIRED') {
                        return `This agent API key is no longer valid: it expired or was revoked.
Next: Reissue it in the AgentTeams web app (project settings → agents) and update .agentteams/config.json, or re-run 'agentteams init' to switch this project to a personal login that refreshes itself.
Details: ${message}`;
                    }
                    const injectedRefreshBlockReason = getInjectedPersonalTokenRefreshBlockReason();
                    if (injectedRefreshBlockReason) {
                        return formatInjectedPersonalToken401(injectedRefreshBlockReason, message);
                    }
                    // A personal login that still fails after the automatic refresh is a
                    // different problem from a wrong API key, and needs a different fix.
                    if (getActiveCredential()) {
                        return `Your AgentTeams login is no longer valid.\nNext: Run 'agentteams auth login' to sign in again.\nDetails: ${message}`;
                    }
                    if (errorCode === 'AUTH_REQUIRED') {
                        return `Authentication required.
Next: Verify your AGENTTEAMS_API_KEY and ensure credentials are configured.
Details: ${message}`;
                    }
                    return `Invalid API key. Please check your AGENTTEAMS_API_KEY environment variable.\nNext: Re-run 'agentteams init' or set AGENTTEAMS_API_KEY.\nDetails: ${message}`;
                }
                case 403:
                    if (errorCode === 'CROSS_PROJECT_ACCESS_DENIED') {
                        return `Cross-project access denied. You don't have permission to access this resource.
Next: Confirm you're using an API key for the same project/team.
Details: ${message}`;
                    }
                    if (errorCode === 'CONVENTION_WRITE_FORBIDDEN') {
                        return `Forbidden.
Next: Convention write operations require proper project/team permissions.
Details: ${message}`;
                    }
                    if (errorCode === 'PROJECT_ACCESS_FORBIDDEN') {
                        return `Forbidden.
Next: Confirm your API key has access to the target project.
Details: ${message}`;
                    }
                    if (typeof message === 'string' && message.toLowerCase().includes('cross-project')) {
                        return `Cross-project access denied. You don't have permission to access this resource.\nNext: Confirm you're using an API key for the same project/team.\nDetails: ${message}`;
                    }
                    return `Forbidden.\nNext: Confirm your API key permissions for this project/team.\nDetails: ${message}`;
                case 404:
                    // The caller already passed an id here, so "pass --repository-id" would leave
                    // them with nothing to do. Name the id itself as the thing to check.
                    if (errorDetailCode === 'WORKTREE_REPOSITORY_ID_NOT_ACCESSIBLE') {
                        return `The repository id you passed is not a repository this runner can access.
Next: Check --repository-id, or confirm the repository is registered in a project this runner can reach.
Details: ${message}`;
                    }
                    // A registered repository whose remote URL differs from origin fails the same
                    // lookup, so do not claim outright that the repository is unregistered.
                    if (errorDetailCode === 'WORKTREE_REPOSITORY_NOT_FOUND') {
                        return `No registered repository matches this Git repository's origin remote.
Next: Register the repository in the project, check that its remote URL matches origin, or pass --repository-id.
Details: ${message}`;
                    }
                    return `Resource not found.\nNext: Check identifiers (e.g., --id) and the target project.\nDetails: ${message}`;
                case 409:
                    // The server names the guide and the hash it wants, so the recovery is
                    // mechanical: resync, re-read the guide, retry. Say that instead of a bare "conflict".
                    if (errorCode === 'GUIDE_OUTDATED') {
                        const guideFileName = typeof data?.guideFileName === 'string' ? data.guideFileName : 'the platform guide';
                        const requiredGuideHash = typeof data?.requiredGuideHash === 'string' ? `\nRequired hash: ${data.requiredGuideHash}` : '';
                        return `Conflict (outdated ${guideFileName}).
Next: Run 'agentteams convention download' to resync platform guides, re-read ${guideFileName}, then retry with the refreshed hash.${requiredGuideHash}
Details: ${message}`;
                    }
                    if (errorDetailCode === 'MUTATION_IN_PROGRESS') {
                        return `Conflict (same idempotency key still running).
Next: An earlier request with this key has not finished. Wait a moment and repeat the same request — it will replay that result instead of writing twice.
Details: ${message}`;
                    }
                    if (errorDetailCode === 'MUTATION_IDEMPOTENCY_KEY_REUSED') {
                        return `Conflict (idempotency key reused).
Next: This key was already used for a different request. Use a new --idempotency-key, or repeat the original request unchanged to replay it.
Details: ${message}`;
                    }
                    if (errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
                        return `Conflict (stale update).
Next: Re-read the record and retry with its latest updatedAt. For conventions, run 'agentteams convention download' first.
Details: ${message}`;
                    }
                    return `Conflict.\nNext: If this is a convention update/delete, run 'agentteams convention download' and retry.\nDetails: ${message}`;
                case 500:
                    return `Server error occurred. Please try again later.\nNext: Retry later. If it persists, check server status/logs.\nDetails: ${message}`;
                default:
                    return `HTTP ${status} error: ${message}`;
            }
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            const apiUrl = resolvedContext?.apiUrl ?? process.env.AGENTTEAMS_API_URL;
            if (typeof apiUrl === 'string' && apiUrl.length > 0) {
                return `Cannot connect to server at ${apiUrl}.\nNext: Check network connectivity and firewall settings.`;
            }
            return "Cannot connect to server (API URL not configured).\nNext: Run 'agentteams init' or set AGENTTEAMS_API_URL.";
        }
        return `Network error: ${error.message}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=errors.js.map