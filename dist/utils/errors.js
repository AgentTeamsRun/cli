import { isAxiosError } from 'axios';
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
export function handleError(error, context) {
    const resolvedContext = getErrorContext(error, context);
    if (isAxiosError(error)) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            const rawMessage = typeof data?.message === 'string' ? data.message : error.message;
            const message = typeof rawMessage === 'string' ? translateServerMessage(rawMessage) : String(rawMessage);
            const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
            switch (status) {
                case 400:
                    if (errorCode === 'VALIDATION_ERROR') {
                        return `Bad request (validation).
Next: Verify required options (e.g., --id/--plan-id) and request parameters.
Details: ${message}`;
                    }
                    return `Bad request. Check your flags and payload.\nNext: Verify required options (e.g., --id/--plan-id) and try again.\nDetails: ${message}`;
                case 401:
                    if (errorCode === 'AUTH_REQUIRED') {
                        return `Authentication required.
Next: Verify your AGENTTEAMS_API_KEY and ensure credentials are configured.
Details: ${message}`;
                    }
                    return `Invalid API key. Please check your AGENTTEAMS_API_KEY environment variable.\nNext: Re-run 'agentteams init' or set AGENTTEAMS_API_KEY.\nDetails: ${message}`;
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
                    return `Resource not found.\nNext: Check identifiers (e.g., --id) and the target project.\nDetails: ${message}`;
                case 409:
                    if (errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
                        return `Conflict (stale update).
Next: Run 'agentteams convention download' and retry with the latest updatedAt.
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