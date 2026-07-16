import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const CONFIG_DIR = '.agentteams';

export const DEFAULT_CONVENTION_REFERENCE = `---
alwaysApply: true
---

# AGENT_RULES

**Before starting any task, always refer to \`.agentteams/convention.md\`.**
`;

export const POST_CHECKOUT_HOOK_MARKER = '# AgentTeams managed post-checkout hook';

// The marker must stay on the exact second line (the first line has to be the
// shebang) — ensurePostCheckoutHook uses it to tell managed hooks from user
// hooks it must never overwrite.
export const POST_CHECKOUT_HOOK_SCRIPT = `#!/bin/sh
${POST_CHECKOUT_HOOK_MARKER}
# Materializes AgentTeams convention entry points in a fresh linked worktree.
# This hook must never fail the checkout: it always exits 0.

previous_head="$1"
branch_checkout="$3"

if [ "$branch_checkout" != "1" ]; then
  exit 0
fi

# git worktree add reports the previous HEAD as the all-zero object id; a
# regular branch checkout reports the real previous commit, which must not
# trigger a bootstrap.
case "$previous_head" in
  0000000000000000000000000000000000000000 | 0000000000000000000000000000000000000000000000000000000000000000) ;;
  *)
    exit 0
    ;;
esac

if ! command -v agentteams >/dev/null 2>&1; then
  echo "agentteams: skipped worktree bootstrap (agentteams CLI not found in PATH)" >&2
  exit 0
fi

if ! agentteams init --format json >/dev/null 2>&1; then
  echo "agentteams: worktree bootstrap failed (agentteams init exited non-zero)" >&2
fi

exit 0
`;

export type ConventionLinkState = 'absent' | 'ready' | 'broken' | 'wrong-target' | 'occupied';

export type ConventionIssueCode =
  | 'not-a-git-repo'
  | 'root-agentteams-missing'
  | 'link-broken'
  | 'link-wrong-target'
  | 'link-occupied'
  | 'link-create-failed'
  | 'exclude-read-failed'
  | 'exclude-write-failed'
  | 'exclude-unsafe-path'
  | 'entry-point-write-failed'
  | 'entry-point-conflict'
  | 'hook-custom'
  | 'hook-hookspath'
  | 'hook-read-failed'
  | 'hook-write-failed'
  | 'hook-unsafe-path';

export interface ConventionIssue {
  code: ConventionIssueCode;
  path: string;
  message: string;
}

export interface EnsureConventionLinkResult {
  status: 'ready' | 'blocked';
  state: ConventionLinkState;
  changed: boolean;
  linkPath: string;
  issue?: ConventionIssue;
}

export interface EnsureLocalExcludeResult {
  status: 'ready' | 'blocked';
  changed: boolean;
  excludePath: string | null;
  addedPatterns: string[];
  issue?: ConventionIssue;
}

export interface EnsurePostCheckoutHookResult {
  status: 'ready' | 'blocked';
  changed: boolean;
  hookPath: string | null;
  issue?: ConventionIssue;
}

export type ConventionEntryPointState = 'created' | 'tracked' | 'existing' | 'blocked';

export interface ConventionEntryPointEntry {
  relativePath: string;
  state: ConventionEntryPointState;
  compatible: boolean;
}

export interface EnsureConventionEntryPointsResult {
  entries: ConventionEntryPointEntry[];
  issues: ConventionIssue[];
  changedCount: number;
  ready: boolean;
}

/** Anchored pattern for `git-common-dir/info/exclude` (repo-root relative). */
export function toAnchoredExcludePattern(relativePath: string): string {
  return `/${relativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

function runGit(args: string[], cwd: string): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function resolveGitCommonDir(repoDir: string): string | null {
  const commonDir = runGit(['rev-parse', '--git-common-dir'], repoDir);
  if (!commonDir) return null;
  return isAbsolute(commonDir) ? resolve(commonDir) : resolve(repoDir, commonDir);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function unsafeMetadataIssue(
  code: 'exclude-unsafe-path' | 'hook-unsafe-path',
  path: string,
  description: string,
): ConventionIssue {
  return {
    code,
    path,
    message: `Refusing to modify unsafe git metadata path ${path}: ${description}.`,
  };
}

function prepareMetadataPath(
  commonDir: string,
  directoryName: 'info' | 'hooks',
  fileName: string,
  issueCode: 'exclude-unsafe-path' | 'hook-unsafe-path',
): { filePath: string; exists: boolean; mode: number; issue?: ConventionIssue } {
  let canonicalCommonDir: string;
  try {
    canonicalCommonDir = realpathSync(commonDir);
  } catch (error) {
    const filePath = join(commonDir, directoryName, fileName);
    return {
      filePath,
      exists: false,
      mode: 0o644,
      issue: unsafeMetadataIssue(issueCode, filePath, toErrorMessage(error)),
    };
  }
  const directoryPath = join(commonDir, directoryName);
  const filePath = join(directoryPath, fileName);

  try {
    let directoryStats;
    try {
      directoryStats = lstatSync(directoryPath);
    } catch {
      mkdirSync(directoryPath);
      directoryStats = lstatSync(directoryPath);
    }

    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      return {
        filePath,
        exists: false,
        mode: 0o644,
        issue: unsafeMetadataIssue(issueCode, directoryPath, 'the parent is a symlink or is not a directory'),
      };
    }

    const canonicalDirectory = realpathSync(directoryPath);
    if (!isContainedPath(canonicalCommonDir, canonicalDirectory)) {
      return {
        filePath,
        exists: false,
        mode: 0o644,
        issue: unsafeMetadataIssue(issueCode, directoryPath, 'the parent resolves outside git-common-dir'),
      };
    }

    try {
      const fileStats = lstatSync(filePath);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        return {
          filePath,
          exists: true,
          mode: fileStats.mode & 0o777,
          issue: unsafeMetadataIssue(issueCode, filePath, 'the target is a symlink or is not a regular file'),
        };
      }
      return { filePath, exists: true, mode: fileStats.mode & 0o777 };
    } catch {
      return { filePath, exists: false, mode: 0o644 };
    }
  } catch (error) {
    return {
      filePath,
      exists: false,
      mode: 0o644,
      issue: unsafeMetadataIssue(issueCode, filePath, toErrorMessage(error)),
    };
  }
}

function writeFileAtomically(path: string, content: string, mode: number): void {
  const tempPath = join(dirname(path), `.${basename(path)}.agentteams-${process.pid}-${Date.now()}`);
  let fileDescriptor: number | null = null;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    fileDescriptor = openSync(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      mode,
    );
    writeFileSync(fileDescriptor, content, 'utf-8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    renameSync(tempPath, path);
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    rmSync(tempPath, { force: true });
  }
}

export function isReadableRegularFile(path: string): boolean {
  try {
    lstatSync(path);
    if (!statSync(path).isFile()) return false;
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function isTrackedInRepo(repoDir: string, relativePath: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
      cwd: repoDir,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function ensureEntryPointParent(repoDir: string, relativePath: string): void {
  const parentRelativePath = dirname(relativePath);
  if (parentRelativePath === '.') return;

  let currentPath = repoDir;
  for (const segment of parentRelativePath.split(/[\\/]/).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    try {
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`${currentPath} is a symlink or is not a directory`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('is a symlink or is not a directory')) throw error;
      mkdirSync(currentPath);
    }
  }
}

export function ensureConventionEntryPoints(
  repoDir: string,
  relativePaths: string[],
  options: { allowCreate: boolean; validateExistingReference: boolean },
): EnsureConventionEntryPointsResult {
  const entries: ConventionEntryPointEntry[] = [];
  const issues: ConventionIssue[] = [];
  let changedCount = 0;

  for (const relativePath of relativePaths) {
    const fullPath = join(repoDir, relativePath);
    let pathExists = false;
    try {
      lstatSync(fullPath);
      pathExists = true;
    } catch {
      pathExists = false;
    }

    if (pathExists) {
      const state: ConventionEntryPointState = isTrackedInRepo(repoDir, relativePath) ? 'tracked' : 'existing';
      let compatible = true;
      if (options.validateExistingReference) {
        try {
          compatible = statSync(fullPath).isFile() && readFileSync(fullPath, 'utf-8') === DEFAULT_CONVENTION_REFERENCE;
        } catch {
          compatible = false;
        }
      }
      entries.push({ relativePath, state, compatible });
      if (!compatible) {
        issues.push({
          code: 'entry-point-conflict',
          path: fullPath,
          message: `${relativePath} in ${repoDir} is ${state} and does not match the standard convention reference; not modifying it.`,
        });
      }
      continue;
    }

    if (!options.allowCreate) {
      entries.push({ relativePath, state: 'blocked', compatible: false });
      continue;
    }

    try {
      ensureEntryPointParent(repoDir, relativePath);
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      const fileDescriptor = openSync(
        fullPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
        0o644,
      );
      try {
        writeFileSync(fileDescriptor, DEFAULT_CONVENTION_REFERENCE, 'utf-8');
      } finally {
        closeSync(fileDescriptor);
      }
      entries.push({ relativePath, state: 'created', compatible: true });
      changedCount += 1;
    } catch (error) {
      issues.push({
        code: 'entry-point-write-failed',
        path: fullPath,
        message: `Could not create ${fullPath}: ${toErrorMessage(error)}`,
      });
      entries.push({ relativePath, state: 'blocked', compatible: false });
    }
  }

  return {
    entries,
    issues,
    changedCount,
    ready: entries.every((entry) => entry.state !== 'blocked' && entry.compatible),
  };
}

/**
 * Classify the `.agentteams` entry of a member repository. Correctness is
 * judged by the canonical target — not the raw link string — so both POSIX
 * relative symlinks and Windows junctions count as `ready` when they resolve
 * to the convention root's `.agentteams`.
 */
export function inspectConventionLink(rootDir: string, repoDir: string): ConventionLinkState {
  const linkPath = join(repoDir, CONFIG_DIR);

  let stats;
  try {
    stats = lstatSync(linkPath);
  } catch {
    return 'absent';
  }

  if (!stats.isSymbolicLink()) return 'occupied';
  if (!existsSync(linkPath)) return 'broken';

  try {
    const canonicalTarget = realpathSync(linkPath);
    const canonicalRoot = realpathSync(join(rootDir, CONFIG_DIR));
    return canonicalTarget === canonicalRoot ? 'ready' : 'wrong-target';
  } catch {
    return 'broken';
  }
}

/**
 * Create the `.agentteams` link only when nothing exists at the path yet.
 * Existing entries — broken links, links to another target, or real files and
 * directories — are preserved and surfaced as issues. A copy fallback is
 * intentionally not offered because copies break the sync guarantee.
 */
export function ensureConventionLink(rootDir: string, repoDir: string): EnsureConventionLinkResult {
  const linkPath = join(repoDir, CONFIG_DIR);
  const rootConfigDir = join(rootDir, CONFIG_DIR);

  if (!existsSync(rootConfigDir)) {
    return {
      status: 'blocked',
      state: 'absent',
      changed: false,
      linkPath,
      issue: {
        code: 'root-agentteams-missing',
        path: rootConfigDir,
        message: `Convention root directory not found: ${rootConfigDir}`,
      },
    };
  }

  const state = inspectConventionLink(rootDir, repoDir);

  if (state === 'ready') {
    return { status: 'ready', state, changed: false, linkPath };
  }

  if (state !== 'absent') {
    const issueByState: Record<Exclude<ConventionLinkState, 'absent' | 'ready'>, ConventionIssue> = {
      broken: {
        code: 'link-broken',
        path: linkPath,
        message: `A broken .agentteams symlink exists at ${linkPath}; remove it manually and re-run.`,
      },
      'wrong-target': {
        code: 'link-wrong-target',
        path: linkPath,
        message: `The .agentteams link at ${linkPath} points somewhere other than the convention root; not modifying it.`,
      },
      occupied: {
        code: 'link-occupied',
        path: linkPath,
        message: `A file or directory already exists at ${linkPath}; not overwriting it.`,
      },
    };
    return { status: 'blocked', state, changed: false, linkPath, issue: issueByState[state] };
  }

  try {
    if (process.platform === 'win32') {
      // Junctions work without elevated privileges; they only accept
      // absolute targets, so this is the documented platform exception to
      // the relative-link rule.
      symlinkSync(realpathSync(rootConfigDir), linkPath, 'junction');
    } else {
      const linkTarget = relative(realpathSync(repoDir), realpathSync(rootConfigDir));
      symlinkSync(linkTarget, linkPath, 'dir');
    }
    return { status: 'ready', state: 'ready', changed: true, linkPath };
  } catch (error) {
    return {
      status: 'blocked',
      state: 'absent',
      changed: false,
      linkPath,
      issue: {
        code: 'link-create-failed',
        path: linkPath,
        message: `Could not create the .agentteams link at ${linkPath}: ${toErrorMessage(error)}`,
      },
    };
  }
}

/**
 * Register anchored patterns in `git-common-dir/info/exclude`. The exclude
 * file is shared by every linked worktree, unlike the tracked `.gitignore`,
 * which must never be modified. Existing content and line endings are
 * preserved; each pattern is appended at most once (exact-line match).
 */
export function ensureLocalExclude(repoDir: string, patterns: string[]): EnsureLocalExcludeResult {
  const commonDir = resolveGitCommonDir(repoDir);
  if (!commonDir) {
    return {
      status: 'blocked',
      changed: false,
      excludePath: null,
      addedPatterns: [],
      issue: {
        code: 'not-a-git-repo',
        path: repoDir,
        message: `Not a git repository: ${repoDir}`,
      },
    };
  }

  const metadataPath = prepareMetadataPath(commonDir, 'info', 'exclude', 'exclude-unsafe-path');
  const excludePath = metadataPath.filePath;
  if (metadataPath.issue) {
    return {
      status: 'blocked',
      changed: false,
      excludePath,
      addedPatterns: [],
      issue: metadataPath.issue,
    };
  }

  let existing = '';
  if (metadataPath.exists) {
    try {
      existing = readFileSync(excludePath, 'utf-8');
    } catch (error) {
      return {
        status: 'blocked',
        changed: false,
        excludePath,
        addedPatterns: [],
        issue: {
          code: 'exclude-read-failed',
          path: excludePath,
          message: `Could not read ${excludePath}: ${toErrorMessage(error)}`,
        },
      };
    }
  }

  const existingLines = new Set(existing.split('\n').map((line) => line.replace(/\r$/, '')));
  const missing = patterns.filter((pattern) => !existingLines.has(pattern));

  if (missing.length === 0) {
    return { status: 'ready', changed: false, excludePath, addedPatterns: [] };
  }

  try {
    const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    writeFileAtomically(
      excludePath,
      existing + separator + missing.map((pattern) => `${pattern}\n`).join(''),
      metadataPath.mode,
    );
    return { status: 'ready', changed: true, excludePath, addedPatterns: missing };
  } catch (error) {
    return {
      status: 'blocked',
      changed: false,
      excludePath,
      addedPatterns: [],
      issue: {
        code: 'exclude-write-failed',
        path: excludePath,
        message: `Could not update ${excludePath}: ${toErrorMessage(error)}`,
      },
    };
  }
}

/**
 * Install or refresh the managed `post-checkout` hook in
 * `git-common-dir/hooks`. A hook is only written when no hook exists or the
 * existing hook carries the exact managed marker on its second line. A
 * non-empty `core.hooksPath` or an unmanaged hook blocks installation —
 * silently redirecting user-managed hook infrastructure is never safe.
 */
export function ensurePostCheckoutHook(repoDir: string): EnsurePostCheckoutHookResult {
  const commonDir = resolveGitCommonDir(repoDir);
  if (!commonDir) {
    return {
      status: 'blocked',
      changed: false,
      hookPath: null,
      issue: {
        code: 'not-a-git-repo',
        path: repoDir,
        message: `Not a git repository: ${repoDir}`,
      },
    };
  }

  const hooksPathConfig = runGit(['config', '--get', 'core.hooksPath'], repoDir);
  if (hooksPathConfig) {
    return {
      status: 'blocked',
      changed: false,
      hookPath: null,
      issue: {
        code: 'hook-hookspath',
        path: hooksPathConfig,
        message: `core.hooksPath is set (${hooksPathConfig}); the managed post-checkout hook cannot take effect.`,
      },
    };
  }

  const metadataPath = prepareMetadataPath(commonDir, 'hooks', 'post-checkout', 'hook-unsafe-path');
  const hookPath = metadataPath.filePath;
  if (metadataPath.issue) {
    return {
      status: 'blocked',
      changed: false,
      hookPath,
      issue: metadataPath.issue,
    };
  }

  let existing: string | null = null;
  if (metadataPath.exists) {
    try {
      existing = readFileSync(hookPath, 'utf-8');
    } catch (error) {
      return {
        status: 'blocked',
        changed: false,
        hookPath,
        issue: {
          code: 'hook-read-failed',
          path: hookPath,
          message: `Could not read ${hookPath}: ${toErrorMessage(error)}`,
        },
      };
    }

    const secondLine = existing.split(/\r?\n/)[1] ?? '';
    if (secondLine !== POST_CHECKOUT_HOOK_MARKER) {
      return {
        status: 'blocked',
        changed: false,
        hookPath,
        issue: {
          code: 'hook-custom',
          path: hookPath,
          message: `An unmanaged post-checkout hook exists at ${hookPath}; not overwriting it.`,
        },
      };
    }
  }

  try {
    if (existing === POST_CHECKOUT_HOOK_SCRIPT) {
      if (process.platform !== 'win32' && (statSync(hookPath).mode & 0o111) === 0) {
        chmodSync(hookPath, 0o755);
        return { status: 'ready', changed: true, hookPath };
      }
      return { status: 'ready', changed: false, hookPath };
    }

    writeFileAtomically(hookPath, POST_CHECKOUT_HOOK_SCRIPT, 0o755);
    if (process.platform !== 'win32') {
      // writeFileSync only applies mode at creation; refreshing an existing
      // managed hook still needs the execute bit guaranteed.
      chmodSync(hookPath, 0o755);
    }
    return { status: 'ready', changed: true, hookPath };
  } catch (error) {
    return {
      status: 'blocked',
      changed: false,
      hookPath,
      issue: {
        code: 'hook-write-failed',
        path: hookPath,
        message: `Could not install ${hookPath}: ${toErrorMessage(error)}`,
      },
    };
  }
}
