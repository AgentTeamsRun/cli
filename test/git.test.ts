import { describe, it, expect } from '@jest/globals';
import { resolve } from 'node:path';
import {
  collectGitMetrics,
  getGitRemoteOriginUrl,
  resolveGitTopLevel,
  resolveMainCheckoutRoot,
} from '../src/utils/git.js';

describe('Git Metrics Utility', () => {
  it('collects commit hash, branch, and shortstat metrics', () => {
    const metrics = collectGitMetrics((cmd, args) => {
      if (cmd !== 'git') {
        throw new Error('unexpected command');
      }

      const serializedArgs = Array.isArray(args) ? args.join(' ') : '';
      if (serializedArgs === 'rev-parse HEAD') return 'abc123\n';
      if (serializedArgs === 'branch --show-current') return 'feature/report-metrics\n';
      if (serializedArgs === 'diff --shortstat HEAD~1') {
        return ' 3 files changed, 15 insertions(+), 4 deletions(-)\n';
      }

      throw new Error(`unexpected args: ${serializedArgs}`);
    });

    expect(metrics).toEqual({
      commitHash: 'abc123',
      branchName: 'feature/report-metrics',
      filesModified: 3,
      linesAdded: 15,
      linesDeleted: 4,
    });
  });

  it('returns empty metrics when git is unavailable', () => {
    const metrics = collectGitMetrics(() => {
      throw new Error('git not found');
    });

    expect(metrics).toEqual({
      commitHash: undefined,
      branchName: undefined,
      filesModified: undefined,
      linesAdded: undefined,
      linesDeleted: undefined,
    });
  });

  it('keeps hash/branch even when shortstat command fails', () => {
    const metrics = collectGitMetrics((cmd, args) => {
      if (cmd !== 'git') {
        throw new Error('unexpected command');
      }

      const serializedArgs = Array.isArray(args) ? args.join(' ') : '';
      if (serializedArgs === 'rev-parse HEAD') return 'def456\n';
      if (serializedArgs === 'branch --show-current') return 'main\n';
      if (serializedArgs === 'diff --shortstat HEAD~1') {
        throw new Error('no previous commit');
      }

      throw new Error(`unexpected args: ${serializedArgs}`);
    });

    expect(metrics).toEqual({
      commitHash: 'def456',
      branchName: 'main',
      filesModified: undefined,
      linesAdded: undefined,
      linesDeleted: undefined,
    });
  });

  it('uses startCommit..HEAD range when startCommit option is provided', () => {
    const metrics = collectGitMetrics(
      (cmd, args) => {
        if (cmd !== 'git') {
          throw new Error('unexpected command');
        }

        const serializedArgs = Array.isArray(args) ? args.join(' ') : '';
        if (serializedArgs === 'rev-parse HEAD') return 'end789\n';
        if (serializedArgs === 'branch --show-current') return 'feat/my-feature\n';
        if (serializedArgs === 'diff --shortstat start123..HEAD') {
          return ' 5 files changed, 42 insertions(+), 10 deletions(-)\n';
        }

        throw new Error(`unexpected args: ${serializedArgs}`);
      },
      { startCommit: 'start123' },
    );

    expect(metrics).toEqual({
      commitHash: 'end789',
      branchName: 'feat/my-feature',
      filesModified: 5,
      linesAdded: 42,
      linesDeleted: 10,
    });
  });

  it('reads the origin remote url when available', () => {
    const remoteUrl = getGitRemoteOriginUrl((cmd, args) => {
      expect(cmd).toBe('git');
      expect(args).toEqual(['remote', 'get-url', 'origin']);
      return 'git@github.com:agentteams/agentteams.git\n';
    });

    expect(remoteUrl).toBe('git@github.com:agentteams/agentteams.git');
  });
});

describe('resolveMainCheckoutRoot', () => {
  it('returns the main checkout root for a linked worktree', () => {
    const root = resolveMainCheckoutRoot('/worktrees/feature', (_cmd, args) => {
      const serializedArgs = args.join(' ');
      if (serializedArgs === 'rev-parse --git-common-dir') return '/repos/project/.git\n';
      if (serializedArgs === 'rev-parse --git-dir') return '/repos/project/.git/worktrees/feature\n';
      throw new Error(`unexpected args: ${serializedArgs}`);
    });

    expect(root).toBe(resolve('/repos/project'));
  });

  it('returns null for the main checkout', () => {
    const root = resolveMainCheckoutRoot('/repos/project', (_cmd, args) => {
      const serializedArgs = args.join(' ');
      if (serializedArgs === 'rev-parse --git-common-dir') return '.git\n';
      if (serializedArgs === 'rev-parse --git-dir') return '.git\n';
      throw new Error(`unexpected args: ${serializedArgs}`);
    });

    expect(root).toBeNull();
  });

  it('returns null when git lookup fails', () => {
    const root = resolveMainCheckoutRoot('/not-a-repository', () => {
      throw new Error('git not found');
    });

    expect(root).toBeNull();
  });

  it('resolves relative git directory output from cwd', () => {
    const root = resolveMainCheckoutRoot('/repos/project', (_cmd, args) => {
      const serializedArgs = args.join(' ');
      if (serializedArgs === 'rev-parse --git-common-dir') return '.git\n';
      if (serializedArgs === 'rev-parse --git-dir') return '.git/worktrees/feature\n';
      throw new Error(`unexpected args: ${serializedArgs}`);
    });

    expect(root).toBe(resolve('/repos/project'));
  });
});

describe('resolveGitTopLevel', () => {
  it('returns an absolute repository root', () => {
    const root = resolveGitTopLevel('/repos/project/packages/cli', (_cmd, args, options) => {
      expect(args).toEqual(['rev-parse', '--show-toplevel']);
      expect(options.cwd).toBe('/repos/project/packages/cli');
      return '/repos/project\n';
    });

    expect(root).toBe(resolve('/repos/project'));
  });

  it('returns null outside a git repository', () => {
    const root = resolveGitTopLevel('/not-a-repository', () => {
      throw new Error('not a git repository');
    });

    expect(root).toBeNull();
  });
});
