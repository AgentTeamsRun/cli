import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DoctorResult } from '../src/commands/doctor.js';
import { printDoctorResult, resolveDoctorExitCode } from '../src/utils/doctorOutput.js';

function captureOutput(spy: ReturnType<typeof jest.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
}

const READY_RESULT: DoctorResult = {
  status: 'READY',
  applicable: true,
  changedCount: 3,
  rootDir: '/projects/kma',
  rootEntryPoints: ['CLAUDE.md', 'AGENTS.md'],
  missingRecommendedEntryPoints: [],
  repositories: [
    {
      path: '/projects/kma/alpha',
      status: 'READY',
      changedCount: 3,
      exclude: 'ready',
      link: 'ready',
      hook: 'ready',
      entryPointConflicts: [],
      issues: [],
    },
  ],
  issues: [
    {
      code: 'daemon-worktree-unsupported',
      path: null,
      message: 'Runner daemons do not yet create worktrees under a non-git project root (informational).',
      severity: 'info',
    },
  ],
};

const DEGRADED_RESULT: DoctorResult = {
  ...READY_RESULT,
  status: 'DEGRADED',
  changedCount: 0,
  missingRecommendedEntryPoints: ['AGENTS.md'],
  repositories: [
    {
      path: '/projects/kma/beta',
      status: 'DEGRADED',
      changedCount: 0,
      exclude: 'ready',
      link: 'occupied',
      hook: 'skipped',
      entryPointConflicts: [{ relativePath: 'CLAUDE.md', state: 'tracked' }],
      issues: [
        {
          code: 'link-occupied',
          path: '/projects/kma/beta/.agentteams',
          message: 'A file or directory already exists at /projects/kma/beta/.agentteams; not overwriting it.',
        },
      ],
    },
  ],
  issues: [
    {
      code: 'missing-recommended-entry-point',
      path: '/projects/kma/AGENTS.md',
      message: 'Recommended entry point AGENTS.md is missing at the convention root.',
      severity: 'error',
    },
  ],
};

const NOT_APPLICABLE_RESULT: DoctorResult = {
  status: 'NOT_APPLICABLE',
  applicable: false,
  changedCount: 0,
  rootDir: '/projects/regular-repo',
  rootEntryPoints: [],
  missingRecommendedEntryPoints: [],
  repositories: [],
  issues: [
    {
      code: 'git-root-project',
      path: '/projects/regular-repo',
      message: '/projects/regular-repo is a git repository root project.',
      severity: 'info',
    },
  ],
};

describe('printDoctorResult', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('json format', () => {
    it('prints exactly one parseable JSON document', () => {
      printDoctorResult(READY_RESULT, 'json');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(logSpy.mock.calls[0][0])) as DoctorResult;
      expect(parsed).toEqual(READY_RESULT);
    });

    it('keeps DEGRADED results a single JSON document too', () => {
      printDoctorResult(DEGRADED_RESULT, 'json');

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual(DEGRADED_RESULT);
    });
  });

  describe('human format', () => {
    it('prints status, root, changes, and repository readiness', () => {
      printDoctorResult(READY_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Status: READY');
      expect(output).toContain('Convention root: /projects/kma');
      expect(output).toContain('Changes applied: 3');
      expect(output).toContain('Root entry points: CLAUDE.md, AGENTS.md');
      expect(output).toContain('/projects/kma/alpha — READY');
      expect(output).toContain('[daemon-worktree-unsupported]');
    });

    it('prints degraded repositories with issue codes, conflicts, and missing entry points', () => {
      printDoctorResult(DEGRADED_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Status: DEGRADED');
      expect(output).toContain('Missing recommended entry points: AGENTS.md');
      expect(output).toContain('/projects/kma/beta — DEGRADED');
      expect(output).toContain('conflict: CLAUDE.md (tracked)');
      expect(output).toContain('[link-occupied]');
      expect(output).toContain('[missing-recommended-entry-point]');
    });

    it('prints the reason for NOT_APPLICABLE results', () => {
      printDoctorResult(NOT_APPLICABLE_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Status: NOT_APPLICABLE');
      expect(output).toContain('[git-root-project]');
    });
  });
});

describe('resolveDoctorExitCode', () => {
  it('maps READY and NOT_APPLICABLE to 0 and DEGRADED to 1', () => {
    expect(resolveDoctorExitCode(READY_RESULT)).toBe(0);
    expect(resolveDoctorExitCode(NOT_APPLICABLE_RESULT)).toBe(0);
    expect(resolveDoctorExitCode(DEGRADED_RESULT)).toBe(1);
  });
});
