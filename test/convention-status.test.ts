import { afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStatusSummary, conventionStatus } from '../src/commands/convention.js';
import { resetPersonalTokenClientsForTests } from '../src/auth/personalTokenClient.js';
import { resetCredentialStoreForTests } from '../src/auth/credentialStore.js';

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

  describe('personal-token project with no stored credential', () => {
    let originalCwd: string;
    let originalEnv: NodeJS.ProcessEnv;
    let root: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      originalEnv = { ...process.env };
      resetPersonalTokenClientsForTests();
      resetCredentialStoreForTests();

      root = mkdtempSync(join(tmpdir(), 'agentteams-conv-status-personal-'));
      mkdirSync(join(root, '.agentteams'), { recursive: true });
      // Exactly what `init --auth personal-token` writes: no `apiKey` at all.
      writeFileSync(
        join(root, '.agentteams', 'config.json'),
        JSON.stringify({ teamId: 't', projectId: 'p', authMode: 'personal-token' }),
        'utf-8',
      );
      delete process.env.AGENTTEAMS_API_KEY;
      // A per-run server keeps the credential slot unique, so a developer who is
      // actually logged in does not turn this into a flaky test.
      process.env.AGENTTEAMS_API_URL = `https://conv-status-${process.pid}.invalid`;
      process.chdir(root);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      process.env = originalEnv;
      rmSync(root, { recursive: true, force: true });
      resetPersonalTokenClientsForTests();
      resetCredentialStoreForTests();
    });

    it('reports that freshness could NOT be checked instead of claiming it is up to date', async () => {
      // The platform convention makes this the session-start freshness gate. A
      // silent "up to date" here means every agent in the project keeps working
      // from stale rules and nobody finds out.
      const result = await conventionStatus({ cwd: root, currentCliVersion: '0.1.0', latestCliVersion: '0.1.0' });

      expect(result.credentialProblem).toContain('agentteams auth login');
      expect(result.actionRequired).toBe(true);
      expect(result.hints.some((hint) => hint.startsWith('WARNING: Convention freshness was NOT checked'))).toBe(true);
      expect(result.hints).not.toContain('OK: Conventions and platform guides are up to date.');
    });
  });
});
