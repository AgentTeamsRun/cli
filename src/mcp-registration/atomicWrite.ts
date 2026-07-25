import { chmodSync, copyFileSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Config files written here belong to the user, not to AgentTeams: they hold
 * other MCP servers, editor preferences and (for user scope) API keys. Every
 * write therefore goes backup → temp file in the same directory → rename, so a
 * crash or a full disk can never leave a truncated config behind.
 */

/** Suffix is deterministic so `install` twice does not accumulate backup files. */
export const BACKUP_SUFFIX = '.agentteams-backup';

/** User-scope files can carry a literal API key, so they must not be world-readable. */
export const USER_SCOPE_FILE_MODE = 0o600;
export const PROJECT_SCOPE_FILE_MODE = 0o644;

export interface AtomicWriteResult {
  path: string;
  /** Absolute path of the backup, or null when the file did not exist yet. */
  backupPath: string | null;
  created: boolean;
  mode: number;
}

function existingMode(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * Replace `path` with `content` atomically.
 *
 * @param targetMode - when present, force the replacement to this mode while
 * preserving the original mode on the backup.
 */
export function writeConfigFileAtomically(
  path: string,
  content: string,
  defaultMode: number,
  targetMode?: number,
): AtomicWriteResult {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });

  const previousMode = existingMode(path);
  const created = previousMode === null;
  const mode = targetMode ?? previousMode ?? defaultMode;

  let backupPath: string | null = null;
  if (!created) {
    backupPath = `${path}${BACKUP_SUFFIX}`;
    copyFileSync(path, backupPath);
    chmodSync(backupPath, previousMode ?? defaultMode);
  }

  // Same directory as the target: `rename` is only atomic within a filesystem.
  const temporaryPath = join(directory, `.${Date.now().toString(36)}-${process.pid}.agentteams-tmp`);
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf-8', mode });
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temp file may never have been created; the original is untouched either way.
    }
    throw error;
  }

  return { path, backupPath, created, mode };
}
