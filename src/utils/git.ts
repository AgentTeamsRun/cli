import * as childProcess from 'node:child_process';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

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

  return dirname(absoluteCommonDir);
}

export function resolveGitTopLevel(
  cwd: string,
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
): string | null {
  const topLevel = runGit(execFileSyncImpl, ['rev-parse', '--show-toplevel'], cwd);
  if (!topLevel) return null;

  return isAbsolute(topLevel) ? resolve(topLevel) : resolve(cwd, topLevel);
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
