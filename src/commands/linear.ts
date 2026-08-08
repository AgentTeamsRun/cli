import {
  createLinearComment,
  createLinearIssue,
  getLinearIssue,
  listLinearComments,
  updateLinearIssue,
} from '../api/linear.js';

/**
 * `projectId` is the project the CLI is configured against; `--project-id` already
 * folded into it through `buildConfigOverrides()` upstream, so callers do not need
 * to re-read `options.projectId` here. Every action forwards it because the route
 * resolves the project from `request.user.projectId` first and the `projectId`
 * query second — only an agent API key carries the former.
 */
export async function executeLinearCommand(
  apiUrl: string,
  projectId: string,
  headers: any,
  action: string,
  options: any,
): Promise<any> {
  switch (action) {
    case 'issue-get': {
      if (!options.issueId) {
        throw new Error('--issue-id is required for linear issue get');
      }

      return getLinearIssue(apiUrl, headers, options.issueId, projectId);
    }
    case 'issue-create': {
      if (!options.title) {
        throw new Error('--title is required for linear issue create');
      }

      return createLinearIssue(
        apiUrl,
        headers,
        options.title,
        options.description,
        options.state,
        options.teamId,
        options.parentId,
        projectId,
      );
    }
    case 'issue-update': {
      if (!options.issueId) {
        throw new Error('--issue-id is required for linear issue update');
      }
      if (!options.state) {
        throw new Error('--state is required for linear issue update');
      }

      return updateLinearIssue(apiUrl, headers, options.issueId, options.state, projectId);
    }
    case 'comment-list': {
      if (!options.issueId) {
        throw new Error('--issue-id is required for linear comment list');
      }

      return listLinearComments(apiUrl, headers, options.issueId, projectId);
    }
    case 'comment-create': {
      if (!options.issueId) {
        throw new Error('--issue-id is required for linear comment create');
      }
      if (!options.body) {
        throw new Error('--body is required for linear comment create');
      }

      return createLinearComment(apiUrl, headers, options.issueId, options.body, projectId);
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
