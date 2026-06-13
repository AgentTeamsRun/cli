import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStatusSummary, conventionStatus } from '../src/commands/convention.js';

describe('buildStatusSummary', () => {
  it('reports up to date when there are no changes', () => {
    expect(buildStatusSummary({ platformGuidesChanged: false, conventionChanges: [] })).toBe(
      '✓ Conventions up to date',
    );
  });

  it('summarizes platform-guide drift and per-type counts when stale', () => {
    const summary = buildStatusSummary({
      platformGuidesChanged: true,
      conventionChanges: [
        { id: 'c1', type: 'new', title: 'testing' },
        { id: 'c2', type: 'updated', title: 'routes' },
        { id: 'c3', type: 'updated', fileName: 'schema.md' },
        { id: 'c4', type: 'deleted', title: 'legacy' },
      ],
    });

    expect(summary).toContain('platform guides');
    expect(summary).toContain('1 new');
    expect(summary).toContain('2 updated');
    expect(summary).toContain('1 deleted');
    expect(summary).toContain('agentteams convention download');
  });
});

describe('conventionStatus', () => {
  it('skips gracefully (up to date, no update) when the project is not configured', async () => {
    // A fresh temp dir has no .agentteams/config.json above it, so findProjectRoot
    // returns null and the check is skipped without any network call.
    const dir = mkdtempSync(join(tmpdir(), 'agentteams-conv-status-'));
    try {
      const result = await conventionStatus({ cwd: dir });
      expect(result).toEqual({
        updateAvailable: false,
        platformGuidesChanged: false,
        conventionChanges: [],
        summary: '✓ Conventions up to date',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
