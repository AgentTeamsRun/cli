import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { conventionDownload } from '../src/commands/convention.js';
import { executeDocumentCommand } from '../src/commands/document.js';
import { loadLocalPlatformGuide, describeMissingGuideHash, resolvePlatformGuide } from '../src/mcp/guides.js';
import { handleError } from '../src/utils/errors.js';

const apiUrl = 'http://localhost:3001';
const projectId = 'project-1';
const headers = { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' };
const documentsUrl = `${apiUrl}/api/projects/${projectId}/documents`;

const createdEnvelope = { data: { id: 'doc-1', title: 't', webUrl: 'https://agentteams.run/doc' } };

function createTempProject(options: { withGuide?: boolean; guideHashes?: Record<string, string> | null }): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-guide-'));
  mkdirSync(join(root, '.agentteams', 'platform'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId, teamId: 'team-1' }), 'utf-8');

  if (options.withGuide !== false) {
    writeFileSync(join(root, '.agentteams', 'platform', 'document-guide.md'), '# Document Guide\n본문\n', 'utf-8');
  }
  if (options.guideHashes !== null) {
    writeFileSync(
      join(root, '.agentteams', 'conventions.manifest.json'),
      JSON.stringify({
        version: 1,
        generatedAt: '2026-08-01T00:00:00.000Z',
        platformGuidesHash: 'aggregate-hash',
        ...(options.guideHashes ? { platformGuideHashes: options.guideHashes } : {}),
        entries: [],
      }),
      'utf-8',
    );
  }
  return root;
}

describe('document write contract fields', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  it('omits contract fields entirely when no option is given (back-compat)', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: createdEnvelope } as never);
    const root = createTempProject({});
    tempRoots.push(root);
    const file = join(root, 'body.md');
    writeFileSync(file, '본문', 'utf-8');

    await executeDocumentCommand(apiUrl, projectId, headers, 'create', { title: '문서', file });

    expect(postSpy).toHaveBeenCalledWith(documentsUrl, { title: '문서', body: '본문' }, { headers });
  });

  it('carries guideHash and idempotencyKey on create', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: createdEnvelope } as never);
    const root = createTempProject({});
    tempRoots.push(root);
    const file = join(root, 'body.md');
    writeFileSync(file, '본문', 'utf-8');

    await executeDocumentCommand(apiUrl, projectId, headers, 'create', {
      title: '문서',
      file,
      guideHash: 'hash-123',
      idempotencyKey: 'key-abc',
    });

    expect(postSpy).toHaveBeenCalledWith(
      documentsUrl,
      { title: '문서', body: '본문', guideHash: 'hash-123', idempotencyKey: 'key-abc' },
      { headers },
    );
  });

  it('carries expectedUpdatedAt on update but still requires a real change', async () => {
    const putSpy = jest.spyOn(axios, 'put').mockResolvedValue({ data: createdEnvelope } as never);

    await executeDocumentCommand(apiUrl, projectId, headers, 'update', {
      id: 'doc-1',
      title: '새 제목',
      guideHash: 'hash-123',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(putSpy).toHaveBeenCalledWith(
      `${documentsUrl}/doc-1`,
      { title: '새 제목', guideHash: 'hash-123', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      { headers },
    );

    // 계약 필드만 준 호출은 "바꿀 내용 없음"으로 남아야 한다.
    await expect(
      executeDocumentCommand(apiUrl, projectId, headers, 'update', { id: 'doc-1', guideHash: 'hash-123' }),
    ).rejects.toThrow(/At least one of --title/);
  });

  it('sends delete contract fields as query params, and none when unset', async () => {
    const deleteSpy = jest.spyOn(axios, 'delete').mockResolvedValue({ data: null } as never);

    await executeDocumentCommand(apiUrl, projectId, headers, 'delete', { id: 'doc-1' });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${documentsUrl}/doc-1`, {
      headers: { 'X-API-Key': 'key_test' },
    });

    await executeDocumentCommand(apiUrl, projectId, headers, 'delete', {
      id: 'doc-1',
      idempotencyKey: 'del-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(deleteSpy).toHaveBeenLastCalledWith(`${documentsUrl}/doc-1`, {
      headers: { 'X-API-Key': 'key_test' },
      params: { idempotencyKey: 'del-1', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
    });
  });
});

describe('local platform guide loader', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  it('returns the local guide body with the hash recorded in the manifest', () => {
    const root = createTempProject({ guideHashes: { 'document-guide.md': 'hash-from-manifest' } });
    tempRoots.push(root);

    const guide = loadLocalPlatformGuide('document', root);

    expect(guide?.fileName).toBe('document-guide.md');
    expect(guide?.source).toBe('local');
    expect(guide?.content).toContain('# Document Guide');
    expect(guide?.guideHash).toBe('hash-from-manifest');
    expect(guide?.filePath).toBe(join(root, '.agentteams', 'platform', 'document-guide.md'));
    expect(describeMissingGuideHash(guide!)).toBeNull();
  });

  it('reports no local guide (rather than throwing) when the file is missing', () => {
    const root = createTempProject({ withGuide: false });
    tempRoots.push(root);

    expect(loadLocalPlatformGuide('document', root)).toBeNull();
    // 세션이 프로젝트 밖에 있을 수도 있다 — 로컬 사본 부재는 실패가 아니라 서버 폴백의 조건이다.
    expect(loadLocalPlatformGuide('document', null)).toBeNull();
  });

  it('degrades to a null hash (not an error) when the manifest predates per-guide hashes', () => {
    const root = createTempProject({});
    tempRoots.push(root);

    const guide = loadLocalPlatformGuide('document', root);

    expect(guide?.content).toContain('# Document Guide');
    expect(guide?.guideHash).toBeNull();
    expect(describeMissingGuideHash(guide!)).toMatch(/agentteams convention download/);
  });

  it('degrades to a null hash when the manifest itself is missing', () => {
    const root = createTempProject({ guideHashes: null });
    tempRoots.push(root);

    expect(loadLocalPlatformGuide('document', root)?.guideHash).toBeNull();
  });

  it('falls back to the server, whose body and hash always come from the same read', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: { data: [{ fileName: 'document-guide.md', content: '# Server Guide\n', hash: 'server-hash' }] },
    } as never);

    const guide = await resolvePlatformGuide('document', { projectRoot: null, apiUrl, headers });

    expect(guide.source).toBe('server');
    expect(guide.content).toContain('# Server Guide');
    expect(guide.guideHash).toBe('server-hash');
  });

  it('names both recovery paths when the local copy and the server both fail', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('connect ECONNREFUSED') as never);

    await expect(resolvePlatformGuide('document', { projectRoot: null, apiUrl, headers })).rejects.toThrow(
      /agentteams convention download/,
    );
  });
});

describe('GUIDE_OUTDATED error translation', () => {
  it('turns the server 409 into a resync instruction that names the guide and hash', () => {
    const message = handleError({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: {
          statusCode: 409,
          error: 'Conflict',
          message: 'Your local document guide is outdated.',
          errorCode: 'GUIDE_OUTDATED',
          errorDetailCode: 'DOCUMENT_GUIDE_OUTDATED',
          requiredGuideHash: 'server-hash',
          guideFileName: 'document-guide.md',
        },
      },
    });

    expect(message).toContain('agentteams convention download');
    expect(message).toContain('document-guide.md');
    expect(message).toContain('server-hash');
  });

  it('explains idempotency key reuse separately from a stale update', () => {
    const reused = handleError({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: { errorCode: 'CONFLICT', errorDetailCode: 'MUTATION_IDEMPOTENCY_KEY_REUSED', message: 'reused' },
      },
    });

    expect(reused).toContain('--idempotency-key');
  });
});

describe('convention download persists per-guide hashes', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  const mockDownloadResponses = (
    guides: Array<Record<string, unknown>>,
    conventions: Array<Record<string, unknown>> = [
      { id: 'conv-1', title: 'Testing', category: 'rules', fileName: 'testing.md', contentMarkdown: '# Testing\n' },
    ],
  ) => {
    jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
      if (url.endsWith('/api/platform/guides')) return { data: { data: guides } };
      if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
      if (url.endsWith('/agent-configs')) return { data: { data: [{ id: 'agent-1' }] } };
      if (url.endsWith('/convention')) return { data: { data: { content: '# AGENT_RULES\n' } } };
      if (url.endsWith('/download-all')) return { data: { data: conventions } };
      throw new Error(`unexpected GET ${url}`);
    }) as never);
  };

  const download = (root: string) =>
    conventionDownload({ cwd: root, config: { projectId, teamId: 'team-1', apiUrl, apiKey: 'key_test' } as never });

  const readManifest = (root: string) =>
    JSON.parse(readFileSync(join(root, '.agentteams', 'conventions.manifest.json'), 'utf-8')) as {
      platformGuidesHash?: string;
      platformGuideHashes?: Record<string, string>;
    };

  it('stores each guide hash under its written file name, keeping the aggregate hash', async () => {
    const root = createTempProject({ guideHashes: null });
    tempRoots.push(root);
    mockDownloadResponses([
      { fileName: 'document-guide.md', title: 'Document Guide', content: '# Document\n', hash: 'doc-hash' },
      { fileName: 'plan-guide.md', title: 'Plan Guide', content: '# Plan\n', hash: 'plan-hash' },
    ]);

    await download(root);

    const manifest = readManifest(root);
    expect(manifest.platformGuideHashes).toEqual({
      'document-guide.md': 'doc-hash',
      'plan-guide.md': 'plan-hash',
    });
    // 구버전 CLI가 비교에 쓰는 집계 해시는 그대로 유지된다.
    expect(manifest.platformGuidesHash).toBe('aggregate-hash');

    // 로더가 방금 저장된 해시를 그대로 읽는다.
    expect(loadLocalPlatformGuide('document', root)?.guideHash).toBe('doc-hash');
  });

  it('still records both hashes for a project that has no conventions yet', async () => {
    const root = createTempProject({ guideHashes: null });
    tempRoots.push(root);
    mockDownloadResponses(
      [{ fileName: 'document-guide.md', title: 'Document Guide', content: '# Document\n', hash: 'doc-hash' }],
      [],
    );

    await download(root);

    const manifest = readManifest(root);
    expect(manifest.platformGuideHashes).toEqual({ 'document-guide.md': 'doc-hash' });
    // 집계 해시가 비면 convention status가 가이드 변경을 영영 감지하지 못한다.
    expect(manifest.platformGuidesHash).toBe('aggregate-hash');
  });

  it('records no hashes when the server does not send them (older API)', async () => {
    const root = createTempProject({ guideHashes: null });
    tempRoots.push(root);
    mockDownloadResponses([{ fileName: 'document-guide.md', title: 'Document Guide', content: '# Document\n' }]);

    await download(root);

    expect(readManifest(root).platformGuideHashes).toBeUndefined();
    // 해시를 모르면 오류가 아니라 "검사 없이 진행"으로 떨어진다.
    expect(loadLocalPlatformGuide('document', root)?.guideHash).toBeNull();
  });

  it('drops stale per-guide hashes instead of leaving them beside freshly written bodies', async () => {
    // 구버전 서버로 되돌아가 해시 없는 본문을 덮어썼는데 이전 해시 맵이 남으면,
    // 파일과 어긋난 해시를 guideHash로 보내 원인 파악이 어려운 GUIDE_OUTDATED가 난다.
    const root = createTempProject({ guideHashes: { 'document-guide.md': 'previous-hash' } });
    tempRoots.push(root);
    mockDownloadResponses([{ fileName: 'document-guide.md', title: 'Document Guide', content: '# Document\n' }]);

    await download(root);

    expect(readManifest(root).platformGuideHashes).toBeUndefined();
  });
});
