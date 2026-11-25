import { getSentryIssue, listSentryIssues } from '../api/sentry.js';
export async function executeSentryCommand(apiUrl, projectId, headers, action, options) {
    switch (action) {
        case 'issue-list': {
            const limit = options.limit === undefined ? undefined : Number(options.limit);
            if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
                throw new Error('--limit must be an integer between 1 and 100');
            }
            return listSentryIssues(apiUrl, projectId, headers, {
                query: options.query,
                cursor: options.cursor,
                limit,
            });
        }
        case 'issue-get': {
            if (!options.issueId)
                throw new Error('--issue-id is required for sentry issue get');
            if (!/^\d+$/.test(options.issueId))
                throw new Error('--issue-id must be a numeric Sentry issue ID');
            return getSentryIssue(apiUrl, projectId, headers, options.issueId);
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=sentry.js.map