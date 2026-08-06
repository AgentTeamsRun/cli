import * as childProcess from 'node:child_process';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { canonicalizePath } from './path.js';

export interface GitMetrics {
  commitHash?: string;
  commitStart?: string;
  commitEnd?: string;
  branchName?: string;
  pullRequestId?: string;
  durationSeconds?: number;
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
  qualityScore?: number;
}

type ExecFileSyncFn = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore']; windowsHide?: boolean },
) => string;

export function collectGitMetrics(
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
  options?: { startCommit?: string },
): GitMetrics {
  const commitHash = runGit(execFileSyncImpl, ['rev-parse', 'HEAD']);
  const branchRaw = runGit(execFileSyncImpl, ['branch', '--show-current']);

  const diffRef = options?.startCommit ? `${options.startCommit}..HEAD` : 'HEAD~1';
  const shortStat = runGit(execFileSyncImpl, ['diff', '--shortstat', diffRef]);

  const parsed = parseShortStat(shortStat);

  return {
    commitHash,
    branchName: branchRaw && branchRaw.length > 0 ? branchRaw : undefined,
    filesModified: parsed.filesModified,
    linesAdded: parsed.linesAdded,
    linesDeleted: parsed.linesDeleted,
  };
}

export function getGitRemoteOriginUrl(
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): string | undefined {
  return runGit(execFileSyncImpl, ['remote', 'get-url', 'origin']);
}

export function resolveMainCheckoutRoot(
  cwd: string,
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): string | null {
  const commonDir = runGit(execFileSyncImpl, ['rev-parse', '--git-common-dir'], cwd);
  const gitDir = runGit(execFileSyncImpl, ['rev-parse', '--git-dir'], cwd);
  if (!commonDir || !gitDir) return null;

  const absoluteCommonDir = isAbsolute(commonDir) ? resolve(commonDir) : resolve(cwd, commonDir);
  const absoluteGitDir = isAbsolute(gitDir) ? resolve(gitDir) : resolve(cwd, gitDir);
  if (absoluteCommonDir === absoluteGitDir || basename(absoluteCommonDir) !== '.git') return null;

  try {
    return canonicalizePath(dirname(absoluteCommonDir));
  } catch {
    return dirname(absoluteCommonDir);
  }
}

/**
 * Does this repository already use linked worktrees?
 *
 * `git worktree list --porcelain` emits one blank-line separated block per
 * worktree, the main checkout first. Counting `worktree ` lines is not enough:
 * a worktree whose directory has been deleted keeps its block — marked
 * `prunable` — until `git worktree prune` runs, so a repository that no longer
 * has any linked worktree would still report one.
 *
 * This deliberately does not try to predict a *future* `git worktree add`: there
 * is no signal for that, and guessing wrong in the permissive direction is what
 * made `agentteams init` write a shared hooks directory for every project.
 * `agentteams doctor --install-worktree-hook` installs the hook on demand, so a
 * wrong guess here costs one command.
 */
export function hasLinkedGitWorktrees(
  cwd: string,
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): boolean {
  const output = runGit(execFileSyncImpl, ['worktree', 'list', '--porcelain'], cwd);
  if (!output) return false;

  const records = output
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.some((line) => line.startsWith('worktree ')));

  // The first record is the main checkout, which is never a linked worktree.
  return records.slice(1).some((lines) => !lines.some((line) => line === 'prunable' || line.startsWith('prunable ')));
}

/**
 * The single rule for "may the managed post-checkout hook be written to this
 * repository's shared hooks directory?".
 *
 * `init` and `doctor` both install that hook, and they must agree: when only
 * `init` gated the write, running `agentteams init` a second time took the
 * configured-project fast path, which calls `doctor`, which installed the hook
 * anyway — the gate existed but never held.
 */
export function shouldInstallWorktreeHook(
  cwd: string,
  options?: { force?: boolean },
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): boolean {
  if (options?.force === true) return true;
  return hasLinkedGitWorktrees(cwd, execFileSyncImpl);
}

export function resolveGitTopLevel(
  cwd: string,
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): string | null {
  const topLevel = runGit(execFileSyncImpl, ['rev-parse', '--show-toplevel'], cwd);
  if (!topLevel) return null;

  try {
    return canonicalizePath(isAbsolute(topLevel) ? topLevel : resolve(cwd, topLevel));
  } catch {
    return isAbsolute(topLevel) ? resolve(topLevel) : resolve(cwd, topLevel);
  }
}

function runGit(execFileSyncImpl: ExecFileSyncFn, args: string[], cwd?: string): string | undefined {
  try {
    const output = execFileSyncImpl('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function parseShortStat(shortStat: string | undefined): {
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
} {
  if (!shortStat) {
    return {};
  }

  const filesMatch = shortStat.match(/(\d+)\s+files?\s+changed/);
  const addedMatch = shortStat.match(/(\d+)\s+insertions?\(\+\)/);
  const deletedMatch = shortStat.match(/(\d+)\s+deletions?\(-\)/);

  return {
    filesModified: filesMatch ? Number.parseInt(filesMatch[1], 10) : undefined,
    linesAdded: addedMatch ? Number.parseInt(addedMatch[1], 10) : undefined,
    linesDeleted: deletedMatch ? Number.parseInt(deletedMatch[1], 10) : undefined,
  };
}
