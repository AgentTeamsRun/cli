import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve a path through the platform-native filesystem implementation.
 *
 * On Windows, Git can report a long path while Node inherits the equivalent
 * 8.3 short path from the environment. The native realpath implementation
 * expands both spellings to the same filesystem path, which makes repository
 * boundary checks deterministic.
 */
export function canonicalizePath(path: string): string {
  return realpathSync.native(resolve(path));
}

export function isSamePath(left: string, right: string): boolean {
  try {
    const canonicalLeft = canonicalizePath(left);
    const canonicalRight = canonicalizePath(right);

    return process.platform === 'win32'
      ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
      : canonicalLeft === canonicalRight;
  } catch {
    return false;
  }
}
