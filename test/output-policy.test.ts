import { describe, it, expect } from '@jest/globals';
import { createSummaryLines, shouldPrintSummary } from '../src/utils/outputPolicy.js';

describe('outputPolicy', () => {
  it.each([
    ['plan', 'create'],
    ['task', 'finish'],
    ['report', 'update'],
    ['postmortem', 'create'],
    ['coaction', 'update'],
    ['document', 'create'],
    ['linear', 'comment-create'],
  ])('keeps full JSON output by default for %s %s', (resource, action) => {
    expect(
      shouldPrintSummary({
        resource,
        action,
        format: 'json',
        formatExplicit: false,
      }),
    ).toBe(false);
  });

  it('forces full output when verbose is enabled', () => {
    expect(
      shouldPrintSummary({
        resource: 'plan',
        action: 'update',
        format: 'json',
        formatExplicit: false,
        verbose: true,
      }),
    ).toBe(false);
  });

  it('prints summary when output-file is used', () => {
    expect(
      shouldPrintSummary({
        resource: 'plan',
        action: 'update',
        format: 'json',
        formatExplicit: true,
        outputFile: './tmp/out.json',
      }),
    ).toBe(true);
  });

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

  it('keeps full output for document update when json is explicitly requested', () => {
    expect(
      shouldPrintSummary({
        resource: 'document',
        action: 'update',
        format: 'json',
        formatExplicit: true,
      }),
    ).toBe(false);
  });

  it('keeps full output for document list by default', () => {
    expect(
      shouldPrintSummary({
        resource: 'document',
        action: 'list',
        format: 'json',
        formatExplicit: false,
      }),
    ).toBe(false);
  });
});
