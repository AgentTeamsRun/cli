import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStatusSummary, conventionStatus } from '../src/commands/convention.js';

describe('buildStatusSummary', () => {
  it('reports up to date when there are no changes', () => {
    expect(buildStatusSummary({ platformGuidesChanged: false, conventionChanges: [] })).toBe(
      '✓ Conventions/platform guides up to date',
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
    expect(summary).toContain('ACTION REQUIRED');
    expect(summary).toContain('agentteams convention download');
  });
});

describe('conventionStatus', () => {
  it('skips gracefully (up to date, no update) when the project is not configured', async () => {
    // A fresh temp dir has no .agentteams/config.json above it, so findProjectRoot
    // returns null and the check is skipped without any network call.
    const dir = mkdtempSync(join(tmpdir(), 'agentteams-conv-status-'));
    try {
      const result = await conventionStatus({ cwd: dir, currentCliVersion: '0.1.0', latestCliVersion: '0.1.0' });
      expect(result).toMatchObject({
        updateAvailable: false,
        conventionUpdateAvailable: false,
        platformGuidesChanged: false,
        conventionChanges: [],
        cliUpdateAvailable: false,
        currentCliVersion: '0.1.0',
        latestCliVersion: '0.1.0',
        actionRequired: false,
        actions: {
          updateCli: null,
          syncConventions: null,
        },
      });
      expect(result.summary).toContain('CLI up to date');
      expect(result.summary).toContain('Conventions/platform guides up to date');
      expect(result.hints).toContain('OK: AgentTeams CLI is up to date (0.1.0).');
      expect(result.hints).toContain('OK: Conventions and platform guides are up to date.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports CLI updates strongly even when convention status is skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentteams-conv-status-'));
    try {
      const result = await conventionStatus({ cwd: dir, currentCliVersion: '0.1.0', latestCliVersion: '0.1.1' });
      expect(result).toMatchObject({
        updateAvailable: false,
        conventionUpdateAvailable: false,
        cliUpdateAvailable: true,
        currentCliVersion: '0.1.0',
        latestCliVersion: '0.1.1',
        actionRequired: true,
        actions: {
          updateCli: 'npm install -g @agentteams/cli',
          syncConventions: null,
        },
      });
      expect(result.summary).toContain('ACTION REQUIRED: AgentTeams CLI update available');
      expect(result.hints[0]).toContain('ACTION REQUIRED: Update AgentTeams CLI first');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
