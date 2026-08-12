import { describe, it, expect, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveApiKeyInput } from '../src/utils/apiKeyInput.js';
import { createSummaryLines } from '../src/utils/outputPolicy.js';
import { printCommandResult } from '../src/program/shared.js';

function capture(run: () => void): string[] {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

const sample = { data: { id: 'plan-123', title: 'CLI output fix' } };

describe('printCommandResult 출력 정책', () => {
  it.each([
    ['plan', 'create'],
    ['task', 'finish'],
    ['report', 'update'],
    ['document', 'create'],
  ])('%s %s는 기본적으로 전체 JSON을 출력한다', (resource, action) => {
    const lines = capture(() => printCommandResult({ result: sample, resource, action }));

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(sample);
  });

  it('--output-file이 있으면 저장 경로와 요약만 출력한다', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentteams-output-policy-'));
    const outputFile = join(directory, 'out.json');
    try {
      const lines = capture(() =>
        printCommandResult({ result: sample, outputFile, resource: 'plan', action: 'update' }),
      );

      expect(lines[0]).toContain(`Saved output to ${outputFile}`);
      expect(lines.slice(1)).toEqual(['Success: plan update', 'id: plan-123, title: CLI output fix']);
      expect(JSON.parse(readFileSync(outputFile, 'utf-8'))).toEqual(sample);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('--output-file과 --verbose를 함께 주면 요약 뒤에 전체 결과도 출력한다', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentteams-output-policy-'));
    const outputFile = join(directory, 'out.json');
    try {
      const lines = capture(() =>
        printCommandResult({ result: sample, outputFile, verbose: true, resource: 'plan', action: 'update' }),
      );

      expect(JSON.parse(lines[lines.length - 1])).toEqual(sample);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('outputPolicy', () => {
  it('creates summary lines with message and id/title', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-123',
          title: 'CLI output fix',
        },
      },
      { resource: 'plan', action: 'create' },
    );

    expect(lines).toEqual([
      'Success: plan create',
      'id: plan-123, title: CLI output fix',
      'Next: agentteams plan start --id plan-123',
    ]);
  });

  it('does not emit a plan upload-html hint for plan create', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-123',
          title: 'CLI output fix',
        },
      },
      { resource: 'plan', action: 'create' },
    );

    expect(lines.some((line) => line.includes('plan upload-html'))).toBe(false);
  });

  it('adds webUrl to summary lines when present', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-123',
          title: 'CLI output fix',
          webUrl: 'https://agentteams.example/plans/plan-123',
        },
      },
      { resource: 'plan', action: 'create' },
    );

    expect(lines).toEqual([
      'Success: plan create',
      'id: plan-123, title: CLI output fix',
      'webUrl: https://agentteams.example/plans/plan-123',
      'Next: agentteams plan start --id plan-123',
    ]);
  });

  it('uses message when available', () => {
    const lines = createSummaryLines(
      {
        message: 'Plan downloaded',
        filePath: '.agentteams/cli/active-plan/a.md',
      },
      { resource: 'plan', action: 'download' },
    );

    expect(lines[0]).toBe('Plan downloaded');
  });

  it('does not create next action hint for plan start', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-456',
          title: 'Started plan',
        },
      },
      { resource: 'plan', action: 'start' },
    );

    expect(lines.some((line) => line.startsWith('Next:'))).toBe(false);
  });

  it('creates next action hint for plan finish when no completion report was created', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-789',
          title: 'Finished plan',
          completionReport: null,
        },
      },
      { resource: 'plan', action: 'finish' },
    );

    expect(lines).toContain('Next: agentteams report create --plan-id plan-789');
  });

  it('suppresses next action hint for plan finish when completion report was already created', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-789',
          title: 'Finished plan',
          completionReport: { id: 'report-001', title: 'Work done' },
        },
      },
      { resource: 'plan', action: 'finish' },
    );

    expect(lines.some((line) => line.startsWith('Next:'))).toBe(false);
  });

  it('never emits an upload-html hint for plan update', () => {
    const lines = createSummaryLines(
      {
        data: {
          id: 'plan-321',
          title: 'CLI output fix',
        },
      },
      { resource: 'plan', action: 'update' },
    );

    expect(lines.some((line) => line.startsWith('Next:'))).toBe(false);
    expect(lines.some((line) => line.includes('plan upload-html'))).toBe(false);
  });

  it('does not echo the document body in output-file summary lines', () => {
    const lines = createSummaryLines(
      {
        message: 'Document updated',
        data: {
          id: 'doc-123',
          title: 'Runbook',
          body: 'A'.repeat(5000),
          webUrl: 'https://agentteams.example/documents/doc-123',
        },
      },
      { resource: 'document', action: 'update' },
    );

    expect(lines).toEqual([
      'Document updated',
      'id: doc-123, title: Runbook',
      'webUrl: https://agentteams.example/documents/doc-123',
    ]);
    expect(lines.some((line) => line.includes('AAAA'))).toBe(false);
  });
});

describe('API key input policy', () => {
  it('reads and trims an API key from --api-key-file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentteams-api-key-file-'));
    const filePath = join(directory, 'token');
    writeFileSync(filePath, 'ats_ci_from_file\n', { encoding: 'utf-8', mode: 0o600 });

    try {
      expect(resolveApiKeyInput({ apiKeyFile: filePath })).toBe('ats_ci_from_file');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reads stdin when --api-key-file is -', () => {
    expect(
      resolveApiKeyInput(
        { apiKeyFile: '-' },
        {
          readFile: () => {
            throw new Error('file reader should not be used');
          },
          readStdin: () => 'ats_ci_from_stdin\r\n',
          warn: () => undefined,
        },
      ),
    ).toBe('ats_ci_from_stdin');
  });

  it('rejects empty API key input', () => {
    expect(() =>
      resolveApiKeyInput({ apiKeyFile: '-' }, { readFile: () => '', readStdin: () => '\n', warn: () => undefined }),
    ).toThrow(/empty/);
  });
});
