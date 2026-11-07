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
export declare const BACKUP_SUFFIX = ".agentteams-backup";
/** User-scope files can carry a literal API key, so they must not be world-readable. */
export declare const USER_SCOPE_FILE_MODE = 384;
export declare const PROJECT_SCOPE_FILE_MODE = 420;
export interface AtomicWriteResult {
    path: string;
    /** Absolute path of the backup, or null when the file did not exist yet. */
    backupPath: string | null;
    created: boolean;
    mode: number;
}
/**
 * Replace `path` with `content` atomically.
 *
 * @param targetMode - when present, force both the replacement and the backup
 * to this mode. Narrowing a 0644 config to 0600 while leaving the backup at
 * 0644 would just copy the secret out at the wider mode under a predictable
 * name, so the backup follows the target rather than the original.
 */
export declare function writeConfigFileAtomically(path: string, content: string, defaultMode: number, targetMode?: number): AtomicWriteResult;
//# sourceMappingURL=atomicWrite.d.ts.map