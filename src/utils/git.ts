import * as childProcess from 'node:child_process';

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
  options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore'] }
) => string;

export function collectGitMetrics(
  execFileSyncImpl: ExecFileSyncFn = childProcess.execFileSync,
  options?: { startCommit?: string },
): GitMetrics {
  const commitHash = runGit(execFileSyncImpl, ['rev-parse', 'HEAD']);
  const branchRaw = runGit(execFileSyncImpl, ['branch', '--show-current']);

  const diffRef = options?.startCommit
    ? `${options.startCommit}..HEAD`
    : 'HEAD~1';
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

function runGit(execFileSyncImpl: ExecFileSyncFn, args: string[]): string | undefined {
  try {
    const output = execFileSyncImpl('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
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
