import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DoctorResult } from '../src/commands/doctor.js';
import { printDoctorResult, resolveDoctorExitCode } from '../src/utils/doctorOutput.js';

function captureOutput(spy: ReturnType<typeof jest.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
}

const READY_RESULT: DoctorResult = {
  status: 'READY',
  layout: 'non-git-root',
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
  rootHook: 'skipped',
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
  layout: 'unknown',
  applicable: false,
  changedCount: 0,
  rootDir: null,
  rootEntryPoints: [],
  missingRecommendedEntryPoints: [],
  repositories: [],
  rootHook: 'skipped',
  issues: [
    {
      code: 'no-project-config',
      path: '/projects/plain-dir',
      message: "No .agentteams/config.json was found from /projects/plain-dir. Run 'agentteams init' first.",
      severity: 'info',
    },
  ],
};

const GIT_ROOT_READY_RESULT: DoctorResult = {
  status: 'READY',
  layout: 'git-root',
  applicable: true,
  changedCount: 1,
  rootDir: '/projects/regular-repo',
  rootEntryPoints: [],
  missingRecommendedEntryPoints: [],
  repositories: [],
  rootHook: 'ready',
  issues: [],
};

const GIT_ROOT_USER_HOOK_RESULT: DoctorResult = {
  ...GIT_ROOT_READY_RESULT,
  changedCount: 0,
  rootHook: 'blocked',
  issues: [
    {
      code: 'hook-custom',
      path: '/projects/regular-repo/.git/hooks/post-checkout',
      message:
        "An unmanaged post-checkout hook exists; not overwriting it. Run 'agentteams init' from the root of each new worktree instead.",
      severity: 'info',
    },
  ],
};

const GIT_ROOT_BLOCKED_RESULT: DoctorResult = {
  ...GIT_ROOT_READY_RESULT,
  status: 'DEGRADED',
  changedCount: 0,
  rootHook: 'blocked',
  issues: [
    {
      code: 'hook-write-failed',
      path: '/projects/regular-repo/.git/hooks/post-checkout',
      message: 'Could not install /projects/regular-repo/.git/hooks/post-checkout: EACCES',
      severity: 'error',
    },
  ],
};

// Preflight stopped before the hook was reached, so `rootHook` says nothing
// about the layout — the member repository view must still stay out of it.
const GIT_ROOT_PREFLIGHT_FAILURE_RESULT: DoctorResult = {
  ...GIT_ROOT_READY_RESULT,
  status: 'DEGRADED',
  changedCount: 0,
  rootHook: 'skipped',
  issues: [
    {
      code: 'root-config-invalid',
      path: '/projects/regular-repo/.agentteams/config.json',
      message: 'The root config at /projects/regular-repo/.agentteams/config.json is not valid JSON.',
      severity: 'error',
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
      expect(output).toContain('[no-project-config]');
    });

    it('reports the bootstrap hook instead of member repositories for a git root project', () => {
      printDoctorResult(GIT_ROOT_READY_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Status: READY');
      expect(output).toContain('Worktree bootstrap hook: ready');
      expect(output).not.toContain('Member repositories');
      expect(output).not.toContain('Root entry points');
    });

    it('reports a hook that could not be installed with its issue code and the manual fallback', () => {
      printDoctorResult(GIT_ROOT_USER_HOOK_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('Worktree bootstrap hook: not installed');
      expect(output).toContain("run 'agentteams init' inside each new worktree");
      expect(output).toContain('[hook-custom]');
    });

    it('keeps the git root view when the diagnosis stopped at preflight', () => {
      printDoctorResult(GIT_ROOT_PREFLIGHT_FAILURE_RESULT, 'human');

      const output = captureOutput(logSpy);
      expect(output).toContain('[root-config-invalid]');
      expect(output).not.toContain('Worktree bootstrap hook');
      expect(output).not.toContain('Member repositories');
      expect(output).not.toContain('Root entry points');
    });
  });
});

describe('resolveDoctorExitCode', () => {
  it('maps READY and NOT_APPLICABLE to 0 and DEGRADED to 1', () => {
    expect(resolveDoctorExitCode(READY_RESULT)).toBe(0);
    expect(resolveDoctorExitCode(NOT_APPLICABLE_RESULT)).toBe(0);
    expect(resolveDoctorExitCode(DEGRADED_RESULT)).toBe(1);
  });

  // A git root project used to always exit 0 via NOT_APPLICABLE. It still does
  // whenever the doctor simply has nothing to install — only a genuine defect
  // (an unwritable hook path, an invalid root config) turns the exit code to 1.
  it('exits 0 for a ready git root project and for a user-managed hook setup', () => {
    expect(resolveDoctorExitCode(GIT_ROOT_READY_RESULT)).toBe(0);
    expect(resolveDoctorExitCode(GIT_ROOT_USER_HOOK_RESULT)).toBe(0);
  });

  it('exits 1 when a git root project cannot be diagnosed or its hook cannot be written', () => {
    expect(resolveDoctorExitCode(GIT_ROOT_BLOCKED_RESULT)).toBe(1);
    expect(resolveDoctorExitCode(GIT_ROOT_PREFLIGHT_FAILURE_RESULT)).toBe(1);
  });
});
