/**
 * Last-resort credential storage: one permission-protected file per slot.
 *
 * The OS credential stores in `credentialStore.ts` are the preferred home for the
 * personal refresh token, but every one of them can be unavailable in exactly the
 * situation a personal login matters most — a remote session:
 *
 *   Linux    no Secret Service on the bus, so `secret-tool` has nothing to talk to
 *   macOS    the login keychain of an SSH session is locked, so writes are refused
 *   Windows  PasswordVault rejects the write for a session with no interactive logon
 *
 * Before this backend existed all three ended the same way: the user walked to
 * another device, approved the request, and was then told the login could not be
 * saved — after which it was revoked. A protected file is a weaker secret than a
 * keyring, and this module never pretends otherwise; it is a deliberate trade
 * against losing the login entirely.
 *
 * What it does not trade away is the protection it *can* enforce, which is where
 * the two platform paths come from:
 *
 *   POSIX    0700 directory, 0600 file, plus an ownership / symlink / node-type
 *            check before every read and write.
 *   Windows  `fs.chmod` only moves the read-only bit there, so `0600` would be a
 *            lie. `icacls` strips inheritance and grants the current user alone,
 *            and an ACL that cannot be set or verified disables the backend
 *            rather than downgrading it to an unprotected file.
 *
 * Every failure here is closed: when the protection cannot be proven, no token is
 * read and none is written. The caller then behaves exactly as it did before this
 * module existed.
 */
import type { CommandRunner, CredentialCommand } from './credentialStore.js';
/** Shown to the user wherever a backend name is reported. */
export declare const FILE_CREDENTIAL_BACKEND = "protected-file";
/** Same `.agentteams` directory the rotation locks live in, one level down. */
export declare const CREDENTIAL_DIR: string[];
/**
 * Opt-out for organisations that forbid a plaintext secret on disk at any
 * protection level. Setting it restores the pre-fallback behaviour for every new
 * login, including the refusal to start device authorization.
 *
 * It gates **writing**, not seeing. A file this CLI wrote before the opt-out was
 * set stays readable and removable, so `auth logout` can still revoke that token
 * and delete it; blinding the store instead would strand a live refresh token on
 * disk with no CLI path left to reach it.
 */
export declare const FILE_CREDENTIALS_DISABLED_ENV = "AGENTTEAMS_DISABLE_FILE_CREDENTIALS";
export type FileCredentialReadResult = {
    kind: 'found';
    secret: string;
} | {
    kind: 'missing';
} | {
    kind: 'error';
    detail: string;
};
export type FileCredentialSaveResult = {
    ok: true;
} | {
    ok: false;
    detail: string;
};
export interface FileCredentialStore {
    readonly backend: typeof FILE_CREDENTIAL_BACKEND;
    /** Absolute path of the credential directory, whether or not it exists yet. */
    readonly directory: string;
    /**
     * Whether this machine can host protection-verified credential files, and if
     * not, why — the only place that reason exists, so a caller that swallows it
     * leaves the user with "the login could not be saved" and nothing else.
     *
     * Creates and hardens the directory, so a failure means the protection could
     * not be established rather than merely that nothing is stored yet. Pass
     * `{ create: false }` for a read-only question such as `auth status`: it
     * reports only what an existing path already rules out, and touches nothing.
     */
    check(options?: {
        create?: boolean;
    }): ProtectionCheck;
    /** Shorthand for `check().ok`, directory creation included. */
    isUsable(): boolean;
    /** Cheap "is there a file for this slot", with no protection check. */
    has(account: string): boolean;
    read(account: string): FileCredentialReadResult;
    save(account: string, secret: string): FileCredentialSaveResult;
    remove(account: string): void;
}
export interface CreateFileCredentialStoreOptions {
    /** Defaults to `<homeDir>/.agentteams/credentials`. */
    directory?: string;
    /** Defaults to `os.homedir()`. */
    homeDir?: string;
    platform?: NodeJS.Platform;
    /** Runs `icacls`. Only ever used on win32. */
    runner?: CommandRunner;
    /** Consulted for the Windows account name. Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /**
     * Restate {@link DIRECTORY_MODE} on a directory that already exists.
     *
     * On by default: a directory this CLI owns should be brought back to 0700
     * rather than turned into a login failure. Tests switch it off to prove that a
     * directory which *cannot* be tightened is refused instead of used.
     */
    hardenDirectory?: boolean;
}
export declare function isFileCredentialFallbackDisabled(env?: NodeJS.ProcessEnv): boolean;
/** `personal-token-<hash>.cred` — the rotation lock's name with a different suffix. */
export declare function credentialFileName(account: string): string;
export interface PosixNodeFacts {
    isSymbolicLink: boolean;
    isDirectory: boolean;
    isFile: boolean;
    /** `stat.mode`; only the permission bits are inspected. */
    mode: number;
    uid: number;
}
export type ProtectionCheck = {
    ok: true;
} | {
    ok: false;
    detail: string;
};
/**
 * Whether a POSIX path is safe to hold, or hand back, a token.
 *
 * Split out from the filesystem so the ownership case is testable: a file owned
 * by another user is the one condition that cannot be staged in a temp directory
 * without root.
 */
export declare function checkPosixProtection(facts: PosixNodeFacts, expected: {
    kind: 'file' | 'directory';
    uid: number;
}, options?: {
    /**
     * Skip the group/other check.
     *
     * Only for the read-only preflight in {@link FileCredentialStore.check}: a
     * `save` chmods the path back to `0700`/`0600` first, so loose bits are a
     * repairable condition there and reporting them would say the fallback is
     * unavailable when it is not. Everything else here — a symlink, a wrong node
     * type, another owner — no chmod can fix.
     */
    ignoreSharedAccess?: boolean;
}): ProtectionCheck;
export interface AclEntry {
    /**
     * Everything `icacls` printed before the permission groups: the granted
     * account, preceded on the first line by the path.
     *
     * Kept whole rather than split into a bare principal because **both** halves
     * may contain spaces — `C:\Users\John Smith\...` and `DOMAIN\John Smith` are
     * both ordinary — and no separator tells them apart. {@link verifyAclOutput}
     * matches by suffix instead.
     */
    subject: string;
    permissions: string[];
}
/** Every `[path ]principal:(perm)(perm)` entry `icacls` printed, in order. */
export declare function parseAclEntries(output: string): AclEntry[];
/**
 * Whether an `icacls` listing shows exactly "this user, explicitly, and nobody
 * else". Anything unreadable, inherited, or shared fails.
 *
 * @param path - The path `icacls` was asked about, so its echo can be told apart
 *   from the account name that follows it.
 */
export declare function verifyAclOutput(output: string, principal: string, path: string): ProtectionCheck;
export declare function buildAclHardenCommand(path: string, principal: string, kind: 'file' | 'directory'): CredentialCommand;
export declare function buildAclInspectCommand(path: string): CredentialCommand;
export declare function createFileCredentialStore(options?: CreateFileCredentialStoreOptions): FileCredentialStore;
//# sourceMappingURL=fileCredentialStore.d.ts.map