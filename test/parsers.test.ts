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
    const existsSync = jest.fn((target: string) => target.includes('.agentteams/cli/temp'));

    (jest as any).unstable_mockModule('node:fs', () => ({
      existsSync,
      unlinkSync,
    }));

    const { deleteIfTempFile } = await import('../src/utils/parsers.js');

    deleteIfTempFile('/tmp/project/.agentteams/cli/temp/report.md');
    deleteIfTempFile('/tmp/project/src/report.md');

    expect(unlinkSync).toHaveBeenCalledTimes(1);
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.agentteams/cli/temp/report.md'));
  });
});
