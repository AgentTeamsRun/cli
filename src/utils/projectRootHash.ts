import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { findProjectConfig } from './config.js';

/**
 * Hash of the project root the CLI is operating in, sent as `X-AgentTeams-Project-Root-Hash`.
 *
 * The server uses it to tell which `AgentConfig` a personal-token request came from: `AgentConfig`
 * stores the absolute path the agent was registered at (`authPath`), so hashing both sides with the
 * *same* rules turns "which folder is this" into an equality check without ever putting a plaintext
 * absolute path on the wire. Sending the path itself would undo the reason `agentteams init`
 * encrypts it (`commands/init.ts` `encryptAuthPath`).
 *
 * ## Normalization contract (the API mirror in `api/src/utils/projectRootHash.ts` must match)
 *
 * 1. The input is an absolute path — the directory that owns `.agentteams/config.json`, not
 *    `process.cwd()`. Running from a subdirectory must produce the same hash.
 * 2. `\` becomes `/`, so a Windows path has one spelling on both sides.
 * 3. Trailing separators are dropped, except when that would empty a POSIX root (`/`).
 * 4. **Case is left alone.** Lowercasing would make two directories that differ only by case
 *    collide on a case-sensitive filesystem, and a collision here attributes a record to the wrong
 *    agent. A Windows path spelled with different casing than at registration simply fails to
 *    match, and the server falls back to matching on `machineId` alone — an empty tool axis is the
 *    intended failure mode, a wrong one is not.
 * 5. The digest is lowercase hex SHA-256 of the UTF-8 bytes.
 */
export const normalizeProjectRootPath = (absolutePath: string): string => {
  const withForwardSlashes = absolutePath.replace(/\\/g, '/');
  const withoutTrailingSlash = withForwardSlashes.replace(/\/+$/, '');
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : '/';
};

export const hashProjectRootPath = (absolutePath: string): string =>
  createHash('sha256').update(normalizeProjectRootPath(absolutePath), 'utf8').digest('hex');

/**
 * Resolve the project root for `startDir` and hash it, or return `null` when there is no project
 * config to anchor on. `null` means the header is omitted — never sent empty.
 */
export const resolveProjectRootHash = (startDir: string = process.cwd()): string | null => {
  const configPath = findProjectConfig(startDir);
  if (!configPath) return null;

  // configPath is `<root>/.agentteams/config.json`, so the root is two levels up.
  return hashProjectRootPath(dirname(dirname(configPath)));
};
