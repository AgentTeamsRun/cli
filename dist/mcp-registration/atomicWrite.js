import { randomBytes } from 'node:crypto';
import { closeSync, fchmodSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
/**
 * Config files written here belong to the user, not to AgentTeams: they hold
 * other MCP servers, editor preferences and (for user scope) API keys. Every
 * write therefore goes backup → temp file in the same directory → rename, so a
 * crash or a full disk can never leave a truncated config behind.
 */
/**
 * Suffix is deterministic so `install` twice does not accumulate backup files.
 * The flip side is that the backup path is fully predictable from the target
 * path, so the backup must never be readable to anyone the target is not.
 */
export const BACKUP_SUFFIX = '.agentteams-backup';
/** User-scope files can carry a literal API key, so they must not be world-readable. */
export const USER_SCOPE_FILE_MODE = 0o600;
export const PROJECT_SCOPE_FILE_MODE = 0o644;
function existingMode(path) {
    try {
        return statSync(path).mode & 0o777;
    }
    catch {
        return null;
    }
}
/** Random suffix: two writes in the same millisecond from the same pid must not collide on `wx`. */
function temporaryPathIn(directory, suffix) {
    return join(directory, `.${randomBytes(8).toString('hex')}${suffix}`);
}
function removeQuietly(path) {
    try {
        unlinkSync(path);
    }
    catch {
        // The file may never have been created; nothing else depends on it existing.
    }
}
/**
 * Create `path` exclusively at `mode`, then write. Content never exists at a
 * mode the caller did not ask for — not even for the width of a
 * `writeFileSync` + `chmodSync` pair, which is exactly the window a predictable
 * backup path makes worth watching. `mode` passed to `open` is still masked by
 * umask, so `fchmod` restates it on the descriptor we already hold rather than
 * on a path another process could have swapped.
 */
function writeNewFileWithMode(path, content, mode) {
    const descriptor = openSync(path, 'wx', mode);
    try {
        fchmodSync(descriptor, mode);
        writeFileSync(descriptor, content);
    }
    finally {
        closeSync(descriptor);
    }
}
/**
 * Replace `path` with `content` atomically.
 *
 * @param targetMode - when present, force both the replacement and the backup
 * to this mode. Narrowing a 0644 config to 0600 while leaving the backup at
 * 0644 would just copy the secret out at the wider mode under a predictable
 * name, so the backup follows the target rather than the original.
 */
export function writeConfigFileAtomically(path, content, defaultMode, targetMode) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true });
    const previousMode = existingMode(path);
    const created = previousMode === null;
    const mode = targetMode ?? previousMode ?? defaultMode;
    let backupPath = null;
    if (!created) {
        backupPath = `${path}${BACKUP_SUFFIX}`;
        // Copying straight onto the backup path would publish the secret at the
        // source mode (or at a stale 0644 backup's mode) until a later chmod caught
        // up, and would leave that copy behind if the chmod threw. Build the backup
        // at the final mode in a temp file instead and rename it into place, which
        // also drops any wider backup an older version left there.
        const backupTemporaryPath = temporaryPathIn(directory, '.agentteams-backup-tmp');
        try {
            writeNewFileWithMode(backupTemporaryPath, readFileSync(path), mode);
            renameSync(backupTemporaryPath, backupPath);
        }
        catch (error) {
            removeQuietly(backupTemporaryPath);
            throw error;
        }
    }
    // Same directory as the target: `rename` is only atomic within a filesystem.
    const temporaryPath = temporaryPathIn(directory, '.agentteams-tmp');
    try {
        writeNewFileWithMode(temporaryPath, content, mode);
        renameSync(temporaryPath, path);
    }
    catch (error) {
        removeQuietly(temporaryPath);
        throw error;
    }
    return { path, backupPath, created, mode };
}
//# sourceMappingURL=atomicWrite.js.map