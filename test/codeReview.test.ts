import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { executeCodeReviewCommand } from '../src/commands/codeReview.js';

describe('code-review create with --findings-file', () => {
  const apiUrl = 'http://localhost:3001';
  const projectId = 'project_1';
  const headers = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };

  let axiosPostSpy: jest.SpiedFunction<typeof axios.post>;
  let tempDir: string;

  const baseOptions = {
    title: 'Test review',
    targetType: 'LOCAL_DIFF',
    runnerType: 'CLAUDE_CODE',
    model: 'claude-opus-4-7',
  };

  const validFinding = {
    severity: 'P1',
    title: 'Missing permission check',
    filePath: 'api/src/routes/example.ts',
    lineStart: 42,
    lineEnd: 45,
    problem: 'Route accepts data without checking membership.',
    impact: 'A member could access another project data.',
    suggestion: 'Call requireProjectMemberAccess before the handler.',
  };

  const writeFindings = (contents: string): string => {
    const filePath = join(tempDir, 'findings.json');
    writeFileSync(filePath, contents, 'utf-8');
    return filePath;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosPostSpy = jest.spyOn(axios, 'post');
    tempDir = mkdtempSync(join(tmpdir(), 'cli-codereview-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('forwards parsed findings array in the POST body', async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: { id: 'cdr_abc', status: 'COMPLETED' } },
    } as any);

    const findingsFile = writeFindings(JSON.stringify([validFinding]));

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
      ...baseOptions,
      findingsFile,
    });

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const [, body] = axiosPostSpy.mock.calls[0];
    expect(body).toMatchObject({
      title: 'Test review',
      targetType: 'LOCAL_DIFF',
      runnerType: 'CLAUDE_CODE',
      model: 'claude-opus-4-7',
      findings: [validFinding],
    });
  });

  it('omits findings from the body when --findings-file is not provided', async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: { id: 'cdr_abc', status: 'PENDING' } },
    } as any);

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'create', baseOptions);

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const [, body] = axiosPostSpy.mock.calls[0];
    expect(body).not.toHaveProperty('findings');
  });

  it('forwards an explicit empty findings array when the file contains an empty array', async () => {
    axiosPostSpy.mockResolvedValueOnce({
      data: { data: { id: 'cdr_abc', status: 'COMPLETED' } },
    } as any);

    const findingsFile = writeFindings('[]');

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
      ...baseOptions,
      findingsFile,
    });

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const [, body] = axiosPostSpy.mock.calls[0];
    expect(body).toHaveProperty('findings');
    expect((body as { findings: unknown }).findings).toEqual([]);
  });

  it('throws when the findings file is not valid JSON', async () => {
    const findingsFile = writeFindings('{ not valid');

    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
        ...baseOptions,
        findingsFile,
      }),
    ).rejects.toThrow(/Invalid findings JSON/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
  });

  it('throws when the findings JSON is not an array', async () => {
    const findingsFile = writeFindings(JSON.stringify({ severity: 'P1' }));

    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
        ...baseOptions,
        findingsFile,
      }),
    ).rejects.toThrow(/findings file must contain a JSON array/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
  });

  it('throws when a finding is missing a required field', async () => {
    const { suggestion: _omit, ...incomplete } = validFinding;
    const findingsFile = writeFindings(JSON.stringify([incomplete]));

    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
        ...baseOptions,
        findingsFile,
      }),
    ).rejects.toThrow(/findings\[0\] missing required field: suggestion/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
  });

  it('throws when the findings file does not exist', async () => {
    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'create', {
        ...baseOptions,
        findingsFile: join(tempDir, 'missing.json'),
      }),
    ).rejects.toThrow(/File not found/);
    expect(axiosPostSpy).not.toHaveBeenCalled();
  });
});

describe('code-review update', () => {
  const apiUrl = 'http://localhost:3001';
  const projectId = 'project_1';
  const headers = { 'X-API-Key': 'key_test123', 'Content-Type': 'application/json' };

  let axiosPatchSpy: jest.SpiedFunction<typeof axios.patch>;

  beforeEach(() => {
    jest.restoreAllMocks();
    axiosPatchSpy = jest.spyOn(axios, 'patch');
  });

  it('forwards only provided metadata fields in the PATCH body', async () => {
    axiosPatchSpy.mockResolvedValueOnce({
      data: {
        data: {
          id: 'cdr_pending',
          title: 'Updated review',
          status: 'PENDING',
          webUrl: 'https://agentteams.run/go?type=code-review&id=cdr_pending',
        },
      },
    } as any);

    await executeCodeReviewCommand(apiUrl, projectId, headers, 'update', {
      id: 'cdr_pending',
      title: 'Updated review',
      targetType: 'BRANCH_DIFF',
      targetRef: 'feat/update-metadata',
      diffSummary: 'Updated diff summary',
      runnerType: 'CODEX',
      model: 'gpt-5-codex',
    });

    expect(axiosPatchSpy).toHaveBeenCalledTimes(1);
    const [url, body, config] = axiosPatchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/projects/project_1/code-reviews/cdr_pending');
    expect(body).toEqual({
      title: 'Updated review',
      targetType: 'BRANCH_DIFF',
      targetRef: 'feat/update-metadata',
      diffSummary: 'Updated diff summary',
      runnerType: 'CODEX',
      model: 'gpt-5-codex',
    });
    expect(config).toMatchObject({ headers });
  });

  it('throws when --id is missing', async () => {
    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'update', {
        title: 'Updated review',
      }),
    ).rejects.toThrow(/--id is required/);
    expect(axiosPatchSpy).not.toHaveBeenCalled();
  });

  it('throws when no metadata fields are provided', async () => {
    await expect(
      executeCodeReviewCommand(apiUrl, projectId, headers, 'update', {
        id: 'cdr_pending',
      }),
    ).rejects.toThrow(/At least one metadata field/);
    expect(axiosPatchSpy).not.toHaveBeenCalled();
  });
});
