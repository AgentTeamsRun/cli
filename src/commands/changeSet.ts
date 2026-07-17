import {
  addChangeSetItemRequest,
  createChangeSetRequest,
  deleteChangeSetRequest,
  getChangeSetRequest,
  listChangeSetsRequest,
  removeChangeSetItemRequest,
  updateChangeSetRequest,
} from '../api/changeSet.js';
import { getGitRemoteOriginUrl } from '../utils/git.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
import { withSpinner } from '../utils/spinner.js';

type RequestContext = {
  apiUrl: string;
  projectId: string;
  headers: Record<string, string>;
};

export const listChangeSets = (context: RequestContext, options: Record<string, unknown>) => {
  const params: Record<string, string | number> = {};
  const status = toNonEmptyString(options.status);
  const page = toPositiveInteger(options.page);
  const pageSize = toPositiveInteger(options.pageSize);
  if (status) params.status = status;
  if (page !== undefined) params.page = page;
  if (pageSize !== undefined) params.pageSize = pageSize;
  return listChangeSetsRequest(context.apiUrl, context.projectId, context.headers, params);
};

export const getChangeSet = (context: RequestContext, id: string) =>
  getChangeSetRequest(context.apiUrl, context.projectId, context.headers, id);

export const createChangeSet = (context: RequestContext, title: string, description?: string) =>
  withSpinner(
    'Creating change set...',
    () =>
      createChangeSetRequest(context.apiUrl, context.projectId, context.headers, {
        title,
        ...(description ? { description } : {}),
      }),
    'Change set created',
  );

export const updateChangeSet = (context: RequestContext, id: string, body: Record<string, unknown>) =>
  withSpinner(
    'Updating change set...',
    () => updateChangeSetRequest(context.apiUrl, context.projectId, context.headers, id, body),
    'Change set updated',
  );

export const deleteChangeSet = (context: RequestContext, id: string) =>
  withSpinner(
    'Deleting change set...',
    () => deleteChangeSetRequest(context.apiUrl, context.projectId, context.headers, id),
    'Change set deleted',
  );

export const addChangeSetItem = async (
  context: RequestContext,
  changeSetId: string,
  mergeOrder: number,
  options: Record<string, unknown>,
) => {
  const repositoryId = toNonEmptyString(options.repositoryId);
  const explicitRepositoryRemoteUrl = toNonEmptyString(options.repositoryRemoteUrl);
  const repositoryRemoteUrl =
    repositoryId || options.git === false
      ? explicitRepositoryRemoteUrl
      : (explicitRepositoryRemoteUrl ?? getGitRemoteOriginUrl());
  if (!repositoryId && !explicitRepositoryRemoteUrl && options.git !== false && !repositoryRemoteUrl) {
    process.stderr.write(
      '[warn] Unable to auto-detect the repository remote URL. Run from a member repository or pass --repository-remote-url.\n',
    );
  }

  const body: Record<string, unknown> = { mergeOrder };
  if (repositoryId) body.repositoryId = repositoryId;
  if (repositoryRemoteUrl) body.repositoryRemoteUrl = repositoryRemoteUrl;
  for (const [field, option] of [
    ['branchName', options.branchName],
    ['targetUrl', options.targetUrl],
    ['codeReviewId', options.codeReviewId],
    ['note', options.note],
  ] as const) {
    const value = toNonEmptyString(option);
    if (value) body[field] = value;
  }

  return withSpinner(
    'Adding change set item...',
    () => addChangeSetItemRequest(context.apiUrl, context.projectId, context.headers, changeSetId, body),
    'Change set item added',
  );
};

export const removeChangeSetItem = (context: RequestContext, changeSetId: string, itemId: string) =>
  withSpinner(
    'Removing change set item...',
    () => removeChangeSetItemRequest(context.apiUrl, context.projectId, context.headers, changeSetId, itemId),
    'Change set item removed',
  );
