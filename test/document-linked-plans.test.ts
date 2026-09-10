import { describe, it, expect, jest, afterEach } from '@jest/globals';
import httpClient from '../src/utils/httpClient.js';
import { executeDocumentCommand } from '../src/commands/document.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};
const documentId = '01a08253-fa19-743e-9fcc-04a2278a72d9';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('document list-plans', () => {
  it('returns the plans linked to a document', async () => {
    const payload = {
      data: [{ id: 'link-1', planId: 'plan-1', documentId, title: 'Linked plan', status: 'TODO' }],
    };
    const get = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: payload } as never);

    const result = await executeDocumentCommand(apiUrl, projectId, headers, 'list-plans', { id: documentId });

    expect(result).toEqual(payload);
    expect(get).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/documents/${documentId}/plans`, {
      headers,
    });
  });

  it('adds a message when no plans are linked', async () => {
    jest.spyOn(httpClient, 'get').mockResolvedValue({ data: { data: [] } } as never);

    await expect(executeDocumentCommand(apiUrl, projectId, headers, 'list-plans', { id: documentId })).resolves.toEqual(
      { data: [], message: 'No linked plans found' },
    );
  });

  it('requires --id', async () => {
    await expect(executeDocumentCommand(apiUrl, projectId, headers, 'list-plans', {})).rejects.toThrow(
      '--id is required for document list-plans',
    );
  });
});
