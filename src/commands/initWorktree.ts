import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from '../utils/git.js';
import { canonicalizePath } from '../utils/path.js';
import { AGENT_ENTRY_POINT_VALUES } from '../utils/agentEntryPoints.js';
import {
  ensureConventionEntryPoints,
  ensureLocalExclude,
  isReadableRegularFile,
  resolveGitCommonDir,
  toAnchoredExcludePattern,
  type ConventionEntryPointState,
  type ConventionIssue,
} from '../utils/conventionLink.js';

const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const RELINK_BACKUP_NAME = 'agentteams-relink';

export type WorktreeEntryPointState = ConventionEntryPointState;

export type WorktreeEntryPointEntry = {
  relativePath: string;
  state: WorktreeEntryPointState;
};

export type WorktreeInitResult = {
  success: true;
  mode: 'worktree';
  worktreePath: string;
  sourcePath: string;
  targetPath: string;
  materialization: 'symlink' | 'copy' | 'relinked' | 'existing' | 'blocked';
  entryPoints: WorktreeEntryPointEntry[];
  issues: ConventionIssue[];
  warning?: string;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConfiguredMainCheckout(sourcePath: string): boolean {
  try {
    const config = JSON.parse(readFileSync(join(sourcePath, CONFIG_FILE), 'utf-8')) as Record<string, unknown>;
    return ['teamId', 'projectId'].every((field) => typeof config[field] === 'string' && config[field].length > 0);
  } catch {
    return false;
  }
}

/**
 * The one precondition set that says "this directory is a linked worktree whose
 * main checkout is already configured".
 *
 * `bootstrapLinkedWorktree` and the read-only classifier both need this answer,
 * and a copy in each would let them drift: the classifier reporting
 * `linked-worktree` while the bootstrap returns null drops init into the full
 * browser OAuth flow with no warning.
 */
export function resolveLinkedWorktreeSource(cwd: string): { worktreePath: string; sourcePath: string } | null {
  let worktreePath: string;
  try {
    worktreePath = canonicalizePath(resolve(cwd));
  } catch {
    return null;
  }

  if (resolveGitTopLevel(worktreePath) !== worktreePath) return null;

  const mainCheckoutRoot = resolveMainCheckoutRoot(worktreePath);
  if (!mainCheckoutRoot) return null;

  const sourcePath = join(mainCheckoutRoot, CONFIG_DIR);
  if (!existsSync(sourcePath) || !isConfiguredMainCheckout(sourcePath)) return null;

  return { worktreePath, sourcePath };
}

/**
 * Materialize the worktree's `.agentteams` entry as a real link.
 *
 * Windows directory symlinks require SeCreateSymbolicLinkPrivilege (Developer
 * Mode or elevation), so an unprivileged win32 run fails with EPERM and used to
 * fall through to a copy — silently breaking the guarantee that a worktree
 * tracks the main checkout's conventions. Junctions need no privilege, which is
 * why `utils/conventionLink.ts` and the daemon's worktree helper already use
 * them; this is the same documented platform exception.
 *
 * The copy fallback stays for environments neither link type supports (UNC
 * paths, filesystems without reparse points). It dereferences because in a
 * non-git-root layout the source is itself a link, and copying a link
 * recursively re-creates it — which fails for exactly the same reason.
 */
function linkConventionDir(
  sourcePath: string,
  targetPath: string,
): { materialization: 'symlink' | 'copy'; warning?: string } {
  try {
    if (process.platform === 'win32') {
      // Junctions only accept absolute targets, so resolve the chain first.
      symlinkSync(realpathSync(sourcePath), targetPath, 'junction');
    } else {
      symlinkSync(sourcePath, targetPath, 'dir');
    }
    return { materialization: 'symlink' };
  } catch (error) {
    cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    return {
      materialization: 'copy',
      warning: `Could not create the .agentteams symlink (${error instanceof Error ? error.message : String(error)}). Copied the directory instead.`,
    };
  }
}

/**
 * Decide whether a plain directory sitting at the worktree's `.agentteams` may
 * be the copy an earlier failed link attempt left behind, rather than something
 * the user created. Identity is judged by the config file, the one artifact a
 * copy reproduces byte for byte — anything else is treated as the user's and is
 * never touched. This only authorizes moving the directory aside; whether the
 * moved copy may be deleted is decided separately by `findCopyOnlyFiles`.
 */
function isCopyOfMainCheckout(sourcePath: string, targetPath: string): boolean {
  try {
    return (
      readFileSync(join(targetPath, CONFIG_FILE), 'utf-8') === readFileSync(join(sourcePath, CONFIG_FILE), 'utf-8')
    );
  } catch {
    return false;
  }
}

function hasIdenticalFile(sourceFile: string, backupFile: string): boolean {
  try {
    const sourceStats = statSync(sourceFile);
    if (!sourceStats.isFile() || sourceStats.size !== statSync(backupFile).size) return false;
    return readFileSync(sourceFile).equals(readFileSync(backupFile));
  } catch {
    return false;
  }
}

/**
 * List every file in the moved-aside copy that the main checkout does not
 * already hold byte for byte. A worktree that ran as a copy accumulates its own
 * artifacts inside `.agentteams` — runner history, evidence, downloaded plans,
 * review findings — and none of them can be regenerated, so the copy is only
 * safe to delete when it is a strict subset of the source. Anything that is not
 * a plain matching file (a symlink, a special file, an unreadable directory)
 * counts as copy-only: it cannot be proven redundant.
 */
function findCopyOnlyFiles(backupPath: string, sourcePath: string): string[] {
  const copyOnlyFiles: string[] = [];

  const walk = (relativeDir: string): void => {
    let entries;
    try {
      entries = readdirSync(join(backupPath, relativeDir), { withFileTypes: true });
    } catch {
      copyOnlyFiles.push(relativeDir || '.');
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (!entry.isFile() || !hasIdenticalFile(join(sourcePath, relativePath), join(backupPath, relativePath))) {
        copyOnlyFiles.push(relativePath);
      }
    }
  };

  walk('');
  return copyOnlyFiles;
}

/**
 * Park the copy outside every tracked surface while the link is created. A
 * backup next to `.agentteams` would show up in `git status` — the anchored
 * `/.agentteams` exclude is an exact match and does not cover a sibling name —
 * and a copied legacy `config.json` may carry the project apiKey.
 * `git-common-dir` is part of no working tree, so nothing can surface from
 * there. A worktree on a different volume cannot be renamed into it, and only
 * then does the in-worktree fallback apply — after registering its own exclude
 * pattern.
 */
function moveConventionCopyAside(worktreePath: string, targetPath: string): { backupPath: string } | { error: string } {
  const failures: string[] = [];

  const commonDir = resolveGitCommonDir(worktreePath);
  if (commonDir) {
    const backupPath = join(commonDir, `${RELINK_BACKUP_NAME}-${process.pid}`);
    try {
      renameSync(targetPath, backupPath);
      return { backupPath };
    } catch (error) {
      failures.push(toErrorMessage(error));
    }
  }

  const excludeResult = ensureLocalExclude(worktreePath, [toAnchoredExcludePattern(`.${RELINK_BACKUP_NAME}`)]);
  if (excludeResult.status !== 'ready') {
    failures.push(
      `the in-worktree backup cannot be kept out of git status (${excludeResult.issue?.message ?? 'local exclude is blocked'})`,
    );
    return { error: failures.join('; ') };
  }

  try {
    const backupPath = join(worktreePath, `.${RELINK_BACKUP_NAME}`);
    renameSync(targetPath, backupPath);
    return { backupPath };
  } catch (error) {
    failures.push(toErrorMessage(error));
    return { error: failures.join('; ') };
  }
}

/** Undo the move-aside. The target may hold a fresh link or a partial copy, and
 * `renameSync` onto a non-empty directory fails with ENOTEMPTY, so clear it
 * first and never let the restore itself escape as an exception. */
function restoreConventionCopy(backupPath: string, targetPath: string): boolean {
  try {
    rmSync(targetPath, { recursive: true, force: true });
    renameSync(backupPath, targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace a copied `.agentteams` directory with a real link so a worktree that
 * predates the link fix starts tracking the main checkout again. Without this
 * the `existing` branch treats the copy as settled and the worktree keeps
 * serving stale conventions forever.
 *
 * The copy is moved aside first and is deleted only once the link is in place
 * *and* the copy proves to be a strict subset of the main checkout; otherwise
 * the backup is kept and its path reported. Any failure restores the original
 * directory, and a failed restore reports where the original is.
 */
function promoteCopiedConventionDir(
  worktreePath: string,
  sourcePath: string,
  targetPath: string,
): { materialization: 'relinked' | 'existing'; issue?: ConventionIssue } {
  if (!isCopyOfMainCheckout(sourcePath, targetPath)) {
    return {
      materialization: 'existing',
      issue: {
        code: 'link-occupied',
        path: targetPath,
        message: `The directory at ${targetPath} does not match the main checkout's ${CONFIG_DIR}; leaving it untouched. Remove it manually to restore the convention link.`,
      },
    };
  }

  const moved = moveConventionCopyAside(worktreePath, targetPath);
  if ('error' in moved) {
    return {
      materialization: 'existing',
      issue: {
        code: 'link-create-failed',
        path: targetPath,
        message: `Could not move the copied ${CONFIG_DIR} aside at ${targetPath}: ${moved.error}`,
      },
    };
  }
  const { backupPath } = moved;

  try {
    const { materialization } = linkConventionDir(sourcePath, targetPath);
    // A copy fallback here would only rebuild the state being replaced.
    if (materialization !== 'symlink') {
      throw new Error('the link could not be created and a copy would not restore the convention chain');
    }
  } catch (error) {
    const restored = restoreConventionCopy(backupPath, targetPath);
    return {
      materialization: 'existing',
      issue: {
        code: 'link-create-failed',
        path: targetPath,
        message: restored
          ? `Could not relink ${targetPath} to the main checkout: ${toErrorMessage(error)}`
          : `Could not relink ${targetPath} to the main checkout: ${toErrorMessage(error)}. The original ${CONFIG_DIR} was left at ${backupPath}; move it back manually.`,
      },
    };
  }

  const copyOnlyFiles = findCopyOnlyFiles(backupPath, sourcePath);
  if (copyOnlyFiles.length > 0) {
    return {
      materialization: 'relinked',
      issue: {
        code: 'link-backup-retained',
        path: backupPath,
        message: `Kept ${copyOnlyFiles.length} file(s) that exist only in the replaced ${CONFIG_DIR} copy (${copyOnlyFiles.slice(0, 3).join(', ')}${copyOnlyFiles.length > 3 ? ', …' : ''}) at ${backupPath}; move what you still need out of it and delete it.`,
      },
    };
  }

  rmSync(backupPath, { recursive: true, force: true });
  return { materialization: 'relinked' };
}

function isBrokenSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && !existsSync(path);
  } catch {
    return false;
  }
}

export function bootstrapLinkedWorktree(cwd: string): WorktreeInitResult | null {
  const linkedWorktree = resolveLinkedWorktreeSource(cwd);
  if (!linkedWorktree) return null;
  const { worktreePath, sourcePath } = linkedWorktree;

  // The convention root is the parent of the canonical .agentteams directory.
  // Following the canonical path resolves double links as well
  // (worktree/.agentteams → member/.agentteams → non-git-root/.agentteams),
  // so the entry point set is read from the actual root — not the member repo.
  let conventionRoot: string | null = null;
  try {
    conventionRoot = dirname(canonicalizePath(sourcePath));
  } catch {
    conventionRoot = null;
  }

  const selectedEntryPoints = conventionRoot
    ? AGENT_ENTRY_POINT_VALUES.filter((relativePath) => isReadableRegularFile(join(conventionRoot, relativePath)))
    : [];

  // Local exclude registration comes before creating any managed path so a
  // bootstrap never dirties the shared repository state.
  const issues: ConventionIssue[] = [];
  const excludeResult = ensureLocalExclude(worktreePath, [
    toAnchoredExcludePattern(CONFIG_DIR),
    ...selectedEntryPoints.map(toAnchoredExcludePattern),
  ]);
  if (excludeResult.status === 'blocked' && excludeResult.issue) {
    issues.push(excludeResult.issue);
  }
  const excludeReady = excludeResult.status === 'ready';

  const targetPath = join(worktreePath, CONFIG_DIR);
  let materialization: WorktreeInitResult['materialization'];
  let warning: string | undefined;

  if (!excludeReady) {
    materialization = existsSync(targetPath) ? 'existing' : 'blocked';
  } else if (isBrokenSymbolicLink(targetPath)) {
    unlinkSync(targetPath);
    ({ materialization, warning } = linkConventionDir(sourcePath, targetPath));
  } else if (existsSync(targetPath)) {
    // An entry that is already a link is settled; a plain directory is either a
    // copy left by a failed link attempt or something the user put there.
    if (lstatSync(targetPath).isSymbolicLink()) {
      materialization = 'existing';
    } else {
      const promotion = promoteCopiedConventionDir(worktreePath, sourcePath, targetPath);
      materialization = promotion.materialization;
      if (promotion.issue) {
        issues.push(promotion.issue);
      }
    }
  } else {
    ({ materialization, warning } = linkConventionDir(sourcePath, targetPath));
  }

  const entryPointResult = ensureConventionEntryPoints(worktreePath, selectedEntryPoints, {
    allowCreate: excludeReady,
    validateExistingReference: false,
  });
  issues.push(...entryPointResult.issues);
  const entryPoints = entryPointResult.entries.map(({ relativePath, state }) => ({ relativePath, state }));

  const result: WorktreeInitResult = {
    success: true,
    mode: 'worktree',
    worktreePath,
    sourcePath,
    targetPath,
    materialization,
    entryPoints,
    issues,
  };

  if (warning) {
    result.warning = warning;
  }

  return result;
}
