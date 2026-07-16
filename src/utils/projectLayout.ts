import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveGitTopLevel } from './git.js';

const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';

/**
 * A "non-git root project" is a directory that carries an AgentTeams config
 * but is not itself inside a git work tree — e.g. a parent folder that groups
 * several member repositories. Subdirectories of a git repository are never
 * treated as non-git roots, so the repo-root config barrier stays intact.
 */
export function isNonGitRootProject(rootDir: string): boolean {
  const root = resolve(rootDir);
  if (!existsSync(join(root, CONFIG_DIR, CONFIG_FILE))) return false;
  return resolveGitTopLevel(root) === null;
}

/**
 * Discover member git repositories directly under a non-git project root.
 *
 * Only physical directories at depth 1 are considered: hidden directories,
 * `node_modules`, symlinked directories, and bare repositories are excluded.
 * A candidate is a member only when its canonical path is itself the top
 * level of a git work tree. Results are sorted by path so repeated runs are
 * deterministic. The returned list never contains config contents or keys —
 * only directory paths.
 */
export function findMemberRepos(rootDir: string): string[] {
  const root = resolve(rootDir);

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const members: string[] = [];

  for (const entry of entries) {
    // Dirent.isDirectory() is false for symlinks, which keeps symlinked
    // directories out without an extra lstat call.
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const candidate = join(root, entry.name);

    // Bare repositories have no work tree, so --show-toplevel resolves null.
    const topLevel = resolveGitTopLevel(candidate);
    if (!topLevel) continue;

    let canonical: string;
    try {
      canonical = realpathSync(candidate);
    } catch {
      continue;
    }

    // Requiring canonical equality keeps out candidates that merely live
    // inside some other repository's work tree.
    if (canonical !== topLevel) continue;

    members.push(candidate);
  }

  return members.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
