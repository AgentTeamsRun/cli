import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('parsers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('splitCsv trims comma-separated values and filters blanks', async () => {
    const { splitCsv } = await import('../src/utils/parsers.js');

    expect(splitCsv(' alpha, beta ,, gamma ')).toEqual(['alpha', 'beta', 'gamma']);
    expect(splitCsv('')).toEqual([]);
    expect(splitCsv(undefined as unknown as string)).toEqual([]);
  });

  it('toNonEmptyString returns a trimmed string and skips invalid input', async () => {
    const { toNonEmptyString } = await import('../src/utils/parsers.js');

    expect(toNonEmptyString(' hello ')).toBe('hello');
    expect(toNonEmptyString('   ')).toBeUndefined();
    expect(toNonEmptyString(123)).toBeUndefined();
  });

  it('toNonNegativeInteger accepts integers and rejects negatives, floats, and non-numbers', async () => {
    const { toNonNegativeInteger } = await import('../src/utils/parsers.js');

    expect(toNonNegativeInteger(0)).toBe(0);
    expect(toNonNegativeInteger('42')).toBe(42);
    expect(toNonNegativeInteger(-1)).toBeUndefined();
    expect(toNonNegativeInteger('3.14')).toBeUndefined();
    expect(toNonNegativeInteger('abc')).toBeUndefined();
  });

  it('toPositiveInteger accepts positive integers only', async () => {
    const { toPositiveInteger } = await import('../src/utils/parsers.js');

    expect(toPositiveInteger(5)).toBe(5);
    expect(toPositiveInteger('7')).toBe(7);
    expect(toPositiveInteger(0)).toBeUndefined();
    expect(toPositiveInteger('-1')).toBeUndefined();
  });

  it('interpretEscapes converts escaped newline sequences', async () => {
    const { interpretEscapes } = await import('../src/utils/parsers.js');

    expect(interpretEscapes('line1\\nline2')).toBe('line1\nline2');
    expect(interpretEscapes('line1\\r\\nline2')).toBe('line1\r\nline2');
  });

  it('stripFrontmatter removes YAML frontmatter when present', async () => {
    const { stripFrontmatter } = await import('../src/utils/parsers.js');

    expect(stripFrontmatter('---\ntitle: Sample\n---\nbody')).toBe('body');
    expect(stripFrontmatter('body')).toBe('body');
  });

  it('toSafeFileName normalizes special characters and limits length', async () => {
    const { toSafeFileName } = await import('../src/utils/parsers.js');

    expect(toSafeFileName('Hello, AgentTeams!')).toBe('hello-agentteams');
    expect(toSafeFileName('---Hello---')).toBe('hello');
    expect(toSafeFileName('A'.repeat(70))).toHaveLength(60);
  });

  it('deleteIfTempFile deletes only .agentteams/cli/temp files', async () => {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return;
    }

    const unlinkSync = jest.fn();
    const existsSync = jest.fn((target: string) => target.replace(/\\/g, '/').includes('.agentteams/cli/temp'));
    const readdirSync = jest.fn(() => [] as string[]);
    const statSync = jest.fn(() => ({ mtimeMs: Date.now() }));

    (jest as any).unstable_mockModule('node:fs', () => ({
      existsSync,
      unlinkSync,
      readdirSync,
      statSync,
    }));

    const { deleteIfTempFile } = await import('../src/utils/parsers.js');

    deleteIfTempFile('/tmp/project/.agentteams/cli/temp/report.md');
    deleteIfTempFile('/tmp/project/src/report.md');

    expect(unlinkSync).toHaveBeenCalledTimes(1);
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringMatching(/\.agentteams[/\\]cli[/\\]temp[/\\]report\.md$/));
  });

  it('pruneStaleCacheFiles deletes stale files of any extension but keeps recent files and directories', async () => {
    if (typeof (jest as any).unstable_mockModule !== 'function') {
      return;
    }

    const STALE_AGE_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stale = now - STALE_AGE_MS - 1000;
    const fresh = now - 1000;

    // cli/temp 와 .agentteams/evidence(= cli 형제) 두 곳에 파일이 있다고 가정
    const tempEntries = ['old-summary.html', 'fresh-dump.json', 'old-runbook.md', 'subdir'];
    const evidenceEntries = ['old-evidence.txt'];

    const fileMeta: Record<string, { mtimeMs: number; isFile: boolean }> = {
      'old-summary.html': { mtimeMs: stale, isFile: true },
      'fresh-dump.json': { mtimeMs: fresh, isFile: true },
      'old-runbook.md': { mtimeMs: stale, isFile: true },
      subdir: { mtimeMs: stale, isFile: false },
      'old-evidence.txt': { mtimeMs: stale, isFile: true },
    };

    const unlinkSync = jest.fn();
    const existsSync = jest.fn((target: string) => {
      const p = target.replace(/\\/g, '/');
      return p.includes('.agentteams/cli/temp') || p.endsWith('.agentteams/evidence');
    });
    const readdirSync = jest.fn((dir: string) => {
      const p = dir.replace(/\\/g, '/');
      if (p.includes('.agentteams/cli/temp')) return tempEntries;
      if (p.endsWith('.agentteams/evidence')) return evidenceEntries;
      return [];
    });
    const statSync = jest.fn((p: string) => {
      const name = p.replace(/\\/g, '/').split('/').pop() as string;
      const meta = fileMeta[name];
      return { mtimeMs: meta.mtimeMs, isFile: () => meta.isFile };
    });

    (jest as any).unstable_mockModule('node:fs', () => ({
      existsSync,
      unlinkSync,
      readdirSync,
      statSync,
    }));

    const { pruneStaleCacheFiles } = await import('../src/utils/parsers.js');

    pruneStaleCacheFiles('/tmp/project');

    const deleted = unlinkSync.mock.calls.map((c) => (c[0] as string).replace(/\\/g, '/').split('/').pop());
    expect(deleted).toContain('old-summary.html'); // 비-md 산출물도 정리됨 (회귀 방지)
    expect(deleted).toContain('old-runbook.md');
    expect(deleted).toContain('old-evidence.txt'); // cli 밖 .agentteams/evidence 도 정리됨
    expect(deleted).not.toContain('fresh-dump.json'); // 최신 파일은 보존
    expect(deleted).not.toContain('subdir'); // 디렉토리는 건너뜀
  });
});
