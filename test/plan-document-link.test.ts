import { describe, it, expect, jest, afterEach } from '@jest/globals';
import httpClient from '../src/utils/httpClient.js';
import { executePlanCommand } from '../src/commands/plan.js';

const apiUrl = 'http://localhost:0';
const projectId = 'test-project';
const headers = {};

const planId = 'f62762fc-730a-4201-8586-e2541505ed1b';
const documentId = '01a08253-fa19-743e-9fcc-04a2278a72d9';
const plansUrl = `${apiUrl}/api/projects/${projectId}/plans/${planId}`;

function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('plan link-document', () => {
  it('posts the document id and optional note', async () => {
    const post = jest
      .spyOn(httpClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'link-1', documentId } } } as never);

    const result = await executePlanCommand(apiUrl, projectId, headers, 'link-document', {
      id: planId,
      documentId,
      note: 'Design notes',
    });

    expect(result).toEqual({ data: { id: 'link-1', documentId } });
    expect(post).toHaveBeenCalledWith(`${plansUrl}/documents`, { documentId, note: 'Design notes' }, { headers });
  });

  it('omits an empty note from the request body', async () => {
    const post = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: { data: { id: 'link-1' } } } as never);

    await executePlanCommand(apiUrl, projectId, headers, 'link-document', { id: planId, documentId, note: '  ' });

    expect(post).toHaveBeenCalledWith(`${plansUrl}/documents`, { documentId }, { headers });
  });

  it('requires --document-id', async () => {
    const post = jest.spyOn(httpClient, 'post');

    await expect(executePlanCommand(apiUrl, projectId, headers, 'link-document', { id: planId })).rejects.toThrow(
      '--document-id is required for plan link-document',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --id', async () => {
    await expect(executePlanCommand(apiUrl, projectId, headers, 'link-document', { documentId })).rejects.toThrow(
      '--id is required for plan link-document',
    );
  });

  // link-issue와 같이, 이미 연결된 상태(409)를 실패로 남기지 않아 재실행해도 안전합니다.
  it('folds a 409 conflict into an idempotent success message', async () => {
    jest.spyOn(httpClient, 'post').mockRejectedValue(httpError(409) as never);

    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'link-document', { id: planId, documentId }),
    ).resolves.toEqual({ message: 'Document already linked (skipped)' });
  });

  it('still surfaces non-409 failures', async () => {
    jest.spyOn(httpClient, 'post').mockRejectedValue(httpError(404) as never);

    await expect(
      executePlanCommand(apiUrl, projectId, headers, 'link-document', { id: planId, documentId }),
    ).rejects.toThrow(/status code 404/);
  });
});

describe('plan unlink-document', () => {
  it('deletes the link and reports what was unlinked', async () => {
    const del = jest.spyOn(httpClient, 'delete').mockResolvedValue({ data: '' } as never);

    const result = await executePlanCommand(apiUrl, projectId, headers, 'unlink-document', { id: planId, documentId });

    expect(result).toEqual({ message: 'Document unlinked', data: { planId, documentId } });
    expect(del).toHaveBeenCalledWith(`${plansUrl}/documents/${documentId}`, expect.any(Object));
  });

  it('requires --document-id', async () => {
    await expect(executePlanCommand(apiUrl, projectId, headers, 'unlink-document', { id: planId })).rejects.toThrow(
      '--document-id is required for plan unlink-document',
    );
  });
});

describe('plan list-documents', () => {
  it('returns the linked documents of a plan', async () => {
    const payload = { data: [{ id: 'link-1', planId, documentId, title: 'Design notes' }] };
    const get = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: payload } as never);

    const result = await executePlanCommand(apiUrl, projectId, headers, 'list-documents', { id: planId });

    expect(result).toEqual(payload);
    expect(get).toHaveBeenCalledWith(`${plansUrl}/documents`, { headers });
  });

  it('requires --id', async () => {
    await expect(executePlanCommand(apiUrl, projectId, headers, 'list-documents', {})).rejects.toThrow(
      '--id is required for plan list-documents',
    );
  });
});
