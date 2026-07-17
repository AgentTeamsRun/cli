import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { executeChangeSetCommand } from '../src/commands/changeSetCommand.js';
import { createSummaryLines } from '../src/utils/outputPolicy.js';

describe('change-set command', () => {
  const context = {
    apiUrl: 'https://api.agentteams.test',
    projectId: 'project-1',
    headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
  };
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let getSpy: jest.SpiedFunction<typeof axios.get>;

  beforeEach(() => {
    jest.restoreAllMocks();
    postSpy = jest.spyOn(axios, 'post');
    getSpy = jest.spyOn(axios, 'get');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('supports create, add-item, and get with merge order and web URL output', async () => {
    postSpy
      .mockResolvedValueOnce({
        data: { data: { id: 'change-set-1', title: 'API + Web release', items: [], webUrl: null } },
      } as never)
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'item-1',
            changeSetId: 'change-set-1',
            mergeOrder: 1,
            codeReviewId: 'review-1',
          },
        },
      } as never);
    getSpy.mockResolvedValueOnce({
      data: {
        data: {
          id: 'change-set-1',
          title: 'API + Web release',
          webUrl: 'https://agentteams.run/go?type=code-review&id=review-1',
          items: [
            {
              id: 'item-1',
              mergeOrder: 1,
              codeReview: { id: 'review-1', title: 'API review', openP0Count: 1, openP1Count: 0 },
            },
          ],
        },
      },
    } as never);

    const created = await executeChangeSetCommand(context, 'create', {
      title: 'API + Web release',
      description: 'Paired reviews',
    });
    expect(created.data.id).toBe('change-set-1');

    await executeChangeSetCommand(context, 'add-item', {
      changeSetId: 'change-set-1',
      repositoryRemoteUrl: 'git@github.com:agentteams/api.git',
      branchName: 'feat/api',
      mergeOrder: '1',
      codeReviewId: 'review-1',
    });
    expect(postSpy.mock.calls[1]?.[1]).toEqual({
      repositoryRemoteUrl: 'git@github.com:agentteams/api.git',
      branchName: 'feat/api',
      mergeOrder: 1,
      codeReviewId: 'review-1',
    });

    const result = await executeChangeSetCommand(context, 'get', { id: 'change-set-1' });
    expect(result.data.items[0].mergeOrder).toBe(1);
    expect(result.data.items[0].codeReview.openP0Count).toBe(1);
    expect(createSummaryLines(result, { resource: 'change-set', action: 'get' })).toContain(
      'webUrl: https://agentteams.run/go?type=code-review&id=review-1',
    );
  });

  it('rejects a non-positive merge order before calling the API', async () => {
    await expect(
      executeChangeSetCommand(context, 'add-item', {
        changeSetId: 'change-set-1',
        mergeOrder: '0',
      }),
    ).rejects.toThrow('--merge-order must be a positive integer');
    expect(postSpy).not.toHaveBeenCalled();
  });
});
