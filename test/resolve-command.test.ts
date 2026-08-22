import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeResolveCommand } from '../src/commands/resolve.js';

const apiUrl = 'http://localhost:3001';
const projectId = 'project-1';
const headers = { 'X-API-Key': 'key', 'Content-Type': 'application/json' };
const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';

const loadContext = async () => ({ apiUrl, projectId, headers });
const failingContext = async () => {
  throw new Error('API context must not be loaded for this reference');
};

describe('resolve command', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  it('rejects an empty reference before touching anything', async () => {
    await expect(executeResolveCommand({ ref: '   ' }, failingContext)).rejects.toThrow('A reference is required');
  });

  it('reports the supported forms for an unidentifiable reference', async () => {
    await expect(executeResolveCommand({ ref: 'nonsense' }, failingContext)).rejects.toThrow(/Supported forms/);
  });

  describe('kind: external', () => {
    it('returns a url and a gh command without any HTTP call or project config', async () => {
      const getSpy = jest.spyOn(axios, 'get');

      const result = await executeResolveCommand({ ref: 'GITHUB_ISSUE:owner/repo#12' }, failingContext);

      expect(result).toMatchObject({
        kind: 'external',
        refType: 'GITHUB_ISSUE',
        url: 'https://github.com/owner/repo/issues/12',
        suggestedCommand: 'gh issue view 12 --repo owner/repo',
      });
      expect(result.url).toBeTruthy();
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  describe('kind: localFile', () => {
    it('returns the local path carried by a convention reference without calling the API', async () => {
      const root = mkdtempSync(join(tmpdir(), 'resolve-local-'));
      tempRoots.push(root);
      mkdirSync(join(root, '.agentteams', 'rules'), { recursive: true });
      writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId }), 'utf-8');
      writeFileSync(join(root, '.agentteams', 'rules', 'context.md'), '# context', 'utf-8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root);
      const getSpy = jest.spyOn(axios, 'get');

      const result = await executeResolveCommand(
        { ref: `convention:${uuid}:.agentteams/rules/context.md` },
        failingContext,
      );

      expect(result).toMatchObject({ kind: 'localFile', refType: 'convention' });
      expect(result.filePath).toBe(join(root, '.agentteams', 'rules', 'context.md'));
      expect(getSpy).not.toHaveBeenCalled();
      cwdSpy.mockRestore();
    });

    // The path segment is user-authored text, and the envelope turns it into a
    // machine-readable "read this file" instruction, so anything outside the
    // project's `.agentteams/` subtree must degrade to the server record.
    it('refuses a path that escapes the project .agentteams subtree', async () => {
      const root = mkdtempSync(join(tmpdir(), 'resolve-escape-'));
      tempRoots.push(root);
      mkdirSync(join(root, '.agentteams'), { recursive: true });
      writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId }), 'utf-8');
      writeFileSync(join(root, 'secret.txt'), 'secret', 'utf-8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root);
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: uuid, title: 'Context' } } } as never);

      for (const escape of ['secret.txt', '.agentteams/../secret.txt', join(root, 'secret.txt')]) {
        const result = await executeResolveCommand({ ref: `convention:${uuid}:${escape}` }, loadContext);
        expect(result).toMatchObject({ kind: 'record', refType: 'convention' });
        expect(result.filePath).toBeUndefined();
      }

      cwdSpy.mockRestore();
    });

    it('falls back to the server record when the local path is missing', async () => {
      const root = mkdtempSync(join(tmpdir(), 'resolve-missing-'));
      tempRoots.push(root);
      mkdirSync(join(root, '.agentteams'), { recursive: true });
      writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId }), 'utf-8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root);
      const getSpy = jest
        .spyOn(axios, 'get')
        .mockResolvedValue({ data: { data: { id: uuid, title: 'Context' } } } as never);

      const result = await executeResolveCommand({ ref: `convention:${uuid}:.agentteams/rules/gone.md` }, loadContext);

      expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/conventions/${uuid}`, { headers });
      expect(result).toMatchObject({ kind: 'record', refType: 'convention' });
      expect(result.message).toContain('Local path not found');
      cwdSpy.mockRestore();
    });
  });

  describe('kind: record', () => {
    it('fetches a code review finding through the finding endpoint, narrowed by the parent review', async () => {
      const findingId = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
      const getSpy = jest
        .spyOn(axios, 'get')
        .mockResolvedValue({ data: { data: { finding: { id: findingId } } } } as never);

      const result = await executeResolveCommand(
        { ref: `codeReview:agentteams_rev_${uuid}:agentteams_rvf_${findingId}` },
        loadContext,
      );

      expect(getSpy).toHaveBeenCalledWith(
        `${apiUrl}/api/projects/${projectId}/code-reviews/findings/${findingId}`,
        expect.objectContaining({ headers, params: { codeReviewId: uuid } }),
      );
      expect(result).toMatchObject({
        kind: 'record',
        refType: 'codeReviewFinding',
        id: findingId,
        parentId: uuid,
      });
      expect(result.record).toMatchObject({ data: { finding: { id: findingId } } });
    });

    it('fetches a plan task through the task endpoint', async () => {
      const taskId = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { task: { id: taskId } } } } as never);

      const result = await executeResolveCommand({ ref: `plan:${uuid}:${taskId}` }, loadContext);

      expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/plans/tasks/${taskId}`, {
        headers,
        params: { planId: uuid },
      });
      expect(result).toMatchObject({ kind: 'record', refType: 'planTask' });
    });

    it('fetches a Linear issue through the Linear endpoint, keeping the raw locator', async () => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: 'lin-1' } } } as never);

      const result = await executeResolveCommand({ ref: `LINEAR_ISSUE:${uuid}` }, loadContext);

      // The project scope has to ride along as a query: only an agent API key
      // carries it on the token, so a personal-token session would get a 401
      // that reads as an expired credential.
      expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/linear/issues/${uuid}`, {
        headers,
        params: { projectId },
      });
      expect(result).toMatchObject({ kind: 'record', refType: 'LINEAR_ISSUE', id: uuid });
    });

    // 토큰은 Sentry의 숫자 ID만 나른다. 그것만으로는 permalink를 만들 수 없으므로(조직·프로젝트
    // 슬러그가 없다), 서버가 프로젝트 바인딩을 검증하고 저장된 permalink를 돌려주는 이 경로가
    // 곧 "링크를 지어내지 않는" 보장이다. 이 케이스가 빠지면 convention.md가 다시 산문으로
    // "그 ID로 permalink를 만들지 마라"를 금지해야 한다.
    it('fetches a Sentry issue through the project-scoped endpoint', async () => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: '12345' } } } as never);

      const result = await executeResolveCommand({ ref: 'SENTRY_ISSUE:12345' }, loadContext);

      expect(getSpy).toHaveBeenCalledWith(`${apiUrl}/api/projects/${projectId}/sentry/issues/12345`, { headers });
      expect(result).toMatchObject({ kind: 'record', refType: 'SENTRY_ISSUE', id: '12345' });
    });

    // 다섯 kind 중 이 하나만 서술문이면, 호출부는 결국 `kind`별 규칙을 따로 갖게 된다 —
    // convention.md에서 지운 그 표가 되돌아오는 경로다.
    it('answers the record kind with an instruction, not a description', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: 'lin-1' } } } as never);

      const result = await executeResolveCommand({ ref: `LINEAR_ISSUE:${uuid}` }, loadContext);

      expect(result.message).toMatch(/use the inline `record` payload/);
    });
  });

  describe('kind: file', () => {
    it('downloads a completion report body and returns the file path instead of inlining markdown', async () => {
      const root = mkdtempSync(join(tmpdir(), 'resolve-file-'));
      tempRoots.push(root);
      mkdirSync(join(root, '.agentteams'), { recursive: true });
      writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId }), 'utf-8');

      const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root);
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: { data: { id: uuid, title: 'Report A', status: 'COMPLETED', content: '# body' } },
      } as never);

      const result = await executeResolveCommand({ ref: `completionReport:agentteams_rpt_${uuid}` }, loadContext);

      expect(result).toMatchObject({ kind: 'file', refType: 'completionReport', id: uuid });
      // Always absolute: the caller's cwd is not necessarily the project root,
      // so a root-relative path would be unopenable from a sub-directory.
      expect(result.filePath).toBe(join(root, '.agentteams', 'cli', 'active-plan', 'report-a-f62762fc.md'));
      expect(result.message).toContain('Read the downloaded file');
      expect(JSON.stringify(result)).not.toContain('# body');
      cwdSpy.mockRestore();
    });
  });

  it('carries the legacy equivalent command for older CLIs on every envelope', async () => {
    const external = await executeResolveCommand({ ref: 'GITLAB_ISSUE:group/project#7' }, failingContext);
    expect(external.fallbackCommand).toBe('glab issue view 7 --repo group/project');
  });
});
