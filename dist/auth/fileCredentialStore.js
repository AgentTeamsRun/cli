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
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialSlotHash } from './slotHash.js';
/** Shown to the user wherever a backend name is reported. */
export const FILE_CREDENTIAL_BACKEND = 'protected-file';
/** Same `.agentteams` directory the rotation locks live in, one level down. */
export const CREDENTIAL_DIR = ['.agentteams', 'credentials'];
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
export const FILE_CREDENTIALS_DISABLED_ENV = 'AGENTTEAMS_DISABLE_FILE_CREDENTIALS';
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
/** Bits that must be clear: anything reachable by group or other. */
const SHARED_ACCESS_MASK = 0o077;
/** Bumped only if the on-disk shape changes; an unknown version is refused. */
const FILE_FORMAT_VERSION = 1;
export function isFileCredentialFallbackDisabled(env = process.env) {
    const value = env[FILE_CREDENTIALS_DISABLED_ENV];
    return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}
/** `personal-token-<hash>.cred` — the rotation lock's name with a different suffix. */
export function credentialFileName(account) {
    return `personal-token-${credentialSlotHash(account)}.cred`;
}
/**
 * Whether a POSIX path is safe to hold, or hand back, a token.
 *
 * Split out from the filesystem so the ownership case is testable: a file owned
 * by another user is the one condition that cannot be staged in a temp directory
 * without root.
 */
export function checkPosixProtection(facts, expected, options = {}) {
    if (facts.isSymbolicLink) {
        return { ok: false, detail: 'it is a symbolic link, which could point anywhere' };
    }
    if (expected.kind === 'file' && !facts.isFile) {
        return { ok: false, detail: 'it is not a regular file' };
    }
    if (expected.kind === 'directory' && !facts.isDirectory) {
        return { ok: false, detail: 'it is not a directory' };
    }
    if (facts.uid !== expected.uid) {
        return { ok: false, detail: 'it is owned by a different user' };
    }
    if (!options.ignoreSharedAccess && (facts.mode & SHARED_ACCESS_MASK) !== 0) {
        return { ok: false, detail: 'it is readable or writable by other users' };
    }
    return { ok: true };
}
/** Every `[path ]principal:(perm)(perm)` entry `icacls` printed, in order. */
export function parseAclEntries(output) {
    const entries = [];
    for (const line of output.split(/\r?\n/)) {
        // The permission groups are the anchor: they run to the end of the line, so
        // the last colon in front of them is the one that separates the subject.
        const match = /^(.*):((?:\([^()]*\))+)\s*$/.exec(line);
        if (!match)
            continue;
        const permissions = [...(match[2] ?? '').matchAll(/\(([^()]*)\)/g)].map((group) => group[1] ?? '');
        entries.push({ subject: (match[1] ?? '').trim(), permissions });
    }
    return entries;
}
/**
 * Whether an entry grants the expected account and nobody else.
 *
 * `icacls` echoes the path it was given in front of the first ACE, and both the
 * path and the account name may contain spaces — `C:\Users\John Smith\...` and
 * `DOMAIN\John Smith` are both ordinary, and nothing in the line says where one
 * ends and the other begins. Removing exactly the path this call passed is what
 * makes the comparison precise; the suffix form is the fallback for a listing
 * that echoed the path in some other shape, and its leading space is what keeps
 * `DESK\dev` from matching an entry for `OTHERDESK\dev`.
 */
function grantsOnly(subject, principal, path) {
    const found = subject.toLowerCase();
    const expected = principal.toLowerCase();
    if (path !== null) {
        const prefix = `${path.toLowerCase()} `;
        // The echo removed exactly: what remains is the account and nothing else.
        if (found.startsWith(prefix))
            return found.slice(prefix.length) === expected;
        // No prefix to remove — a listing that echoed the path in some other shape.
        // Tolerated, but only here, and only with the separating space.
        return found === expected || found.endsWith(` ${expected}`);
    }
    return found === expected;
}
/**
 * Whether an `icacls` listing shows exactly "this user, explicitly, and nobody
 * else". Anything unreadable, inherited, or shared fails.
 *
 * @param path - The path `icacls` was asked about, so its echo can be told apart
 *   from the account name that follows it.
 */
export function verifyAclOutput(output, principal, path) {
    const entries = parseAclEntries(output);
    if (entries.length === 0) {
        return { ok: false, detail: 'its access control list could not be read' };
    }
    for (const [index, entry] of entries.entries()) {
        // `(I)` marks an inherited ACE. `(OI)` / `(CI)` are propagation flags on an
        // explicit one, which is what a directory grant is supposed to look like.
        if (entry.permissions.includes('I')) {
            return { ok: false, detail: 'it still inherits permissions from its parent directory' };
        }
        // Only the first entry carries the path; every later line is an account on
        // its own and is compared as one, so `NT AUTHORITY\SYSTEM` can never pass as
        // a principal that happens to end the same way.
        if (!grantsOnly(entry.subject, principal, index === 0 ? path : null)) {
            return { ok: false, detail: 'its access control list grants another account' };
        }
    }
    return { ok: true };
}
export function buildAclHardenCommand(path, principal, kind) {
    // `/inheritance:r` converts inherited entries away and then removes them;
    // `/grant:r` replaces any existing grant for the principal rather than adding
    // to it, so re-running this is idempotent.
    const grant = kind === 'directory' ? `${principal}:(OI)(CI)(F)` : `${principal}:(F)`;
    return { command: 'icacls', args: [path, '/inheritance:r', '/grant:r', grant, '/Q', '/C'] };
}
export function buildAclInspectCommand(path) {
    return { command: 'icacls', args: [path] };
}
/** `DOMAIN\user`, the form `icacls` prints. */
function resolveWindowsPrincipal(env) {
    const user = env.USERNAME?.trim();
    if (!user)
        return null;
    const domain = env.USERDOMAIN?.trim();
    return domain ? `${domain}\\${user}` : user;
}
function fileSystemDetail(error) {
    // `code` is stable across locales; `message` embeds the path, which is not a
    // secret but is noise in a user-facing line.
    const code = error?.code;
    return code ? `the filesystem refused the operation (${code})` : 'the filesystem refused the operation';
}
export function createFileCredentialStore(options = {}) {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const runner = options.runner;
    const hardenDirectoryMode = options.hardenDirectory ?? true;
    const directory = options.directory ?? join(options.homeDir ?? homedir(), ...CREDENTIAL_DIR);
    const isWindows = platform === 'win32';
    const windowsPrincipal = isWindows ? resolveWindowsPrincipal(env) : null;
    const pathFor = (account) => join(directory, credentialFileName(account));
    const runIcacls = (command) => {
        if (!runner)
            return { ok: false, stdout: '' };
        const result = runner(command);
        return { ok: result.status === 0, stdout: result.stdout };
    };
    /** Set, then prove, the protection on a path that already exists. */
    const protectPath = (path, kind) => {
        if (isWindows) {
            if (!windowsPrincipal) {
                return { ok: false, detail: 'Windows did not report which account is running this command' };
            }
            if (!runIcacls(buildAclHardenCommand(path, windowsPrincipal, kind)).ok) {
                return { ok: false, detail: 'its access control list could not be set with icacls' };
            }
            const inspected = runIcacls(buildAclInspectCommand(path));
            if (!inspected.ok) {
                return { ok: false, detail: 'its access control list could not be read with icacls' };
            }
            return verifyAclOutput(inspected.stdout, windowsPrincipal, path);
        }
        let facts;
        try {
            facts = lstatSync(path);
        }
        catch (error) {
            return { ok: false, detail: fileSystemDetail(error) };
        }
        // Never chmod through a link: that would apply the mode to whatever it points
        // at. The check below rejects the link itself.
        if (!facts.isSymbolicLink() && ((kind === 'directory' && hardenDirectoryMode) || kind === 'file')) {
            try {
                chmodSync(path, kind === 'directory' ? DIRECTORY_MODE : FILE_MODE);
            }
            catch {
                // Not ours to tighten. The verification below is what decides.
            }
            try {
                facts = lstatSync(path);
            }
            catch (error) {
                return { ok: false, detail: fileSystemDetail(error) };
            }
        }
        return checkPosixProtection({
            isSymbolicLink: facts.isSymbolicLink(),
            isDirectory: facts.isDirectory(),
            isFile: facts.isFile(),
            mode: facts.mode,
            uid: facts.uid,
        }, { kind, uid: process.getuid?.() ?? facts.uid });
    };
    /**
     * Inspect an existing path without touching it.
     *
     * Used before a read and before a write: a path that is already wrong must be
     * reported, not silently repaired, because a credential file this CLI did not
     * write is evidence of tampering rather than of a stale umask.
     */
    const inspectExistingFile = (path) => {
        if (isWindows) {
            try {
                lstatSync(path);
            }
            catch (error) {
                if (error?.code === 'ENOENT')
                    return { kind: 'missing' };
                return { ok: false, detail: fileSystemDetail(error) };
            }
            if (!windowsPrincipal) {
                return { ok: false, detail: 'Windows did not report which account is running this command' };
            }
            const inspected = runIcacls(buildAclInspectCommand(path));
            if (!inspected.ok)
                return { ok: false, detail: 'its access control list could not be read with icacls' };
            return verifyAclOutput(inspected.stdout, windowsPrincipal, path);
        }
        let facts;
        try {
            facts = lstatSync(path);
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { kind: 'missing' };
            return { ok: false, detail: fileSystemDetail(error) };
        }
        return checkPosixProtection({
            isSymbolicLink: facts.isSymbolicLink(),
            isDirectory: facts.isDirectory(),
            isFile: facts.isFile(),
            mode: facts.mode,
            uid: facts.uid,
        }, { kind: 'file', uid: process.getuid?.() ?? facts.uid });
    };
    let usable = null;
    const ensureDirectory = () => {
        if (usable !== null)
            return usable;
        try {
            mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
        }
        catch (error) {
            if (error?.code !== 'EEXIST') {
                usable = { ok: false, detail: fileSystemDetail(error) };
                return usable;
            }
        }
        usable = protectPath(directory, 'directory');
        return usable;
    };
    /**
     * What the existing directory already rules out, without creating or changing
     * anything.
     *
     * `auth status` is a read-only question and must not leave a credential
     * directory on a machine that has never stored a login. An absent directory is
     * therefore not a failure — `save()` creates it — and neither are the
     * conditions `save()` repairs on the way (loose POSIX bits, an ACL that has
     * not been applied yet). Only what no harden could fix is reported.
     */
    const inspectDirectory = () => {
        // A real attempt already happened; its answer is the authoritative one.
        if (usable !== null)
            return usable;
        if (isWindows && !windowsPrincipal) {
            return { ok: false, detail: 'Windows did not report which account is running this command' };
        }
        let facts;
        try {
            facts = lstatSync(directory);
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { ok: true };
            return { ok: false, detail: fileSystemDetail(error) };
        }
        // The Windows ACL is applied by `save()`, and inspecting it here would say
        // nothing about a directory that has never been hardened.
        if (isWindows)
            return { ok: true };
        return checkPosixProtection({
            isSymbolicLink: facts.isSymbolicLink(),
            isDirectory: facts.isDirectory(),
            isFile: facts.isFile(),
            mode: facts.mode,
            uid: facts.uid,
        }, { kind: 'directory', uid: process.getuid?.() ?? facts.uid }, { ignoreSharedAccess: true });
    };
    const removeQuietly = (path) => {
        try {
            unlinkSync(path);
        }
        catch {
            // Already gone, or never created. Either way there is nothing to clean up.
        }
    };
    return {
        backend: FILE_CREDENTIAL_BACKEND,
        directory,
        check(options) {
            return options?.create === false ? inspectDirectory() : ensureDirectory();
        },
        isUsable() {
            return ensureDirectory().ok;
        },
        has(account) {
            try {
                lstatSync(pathFor(account));
                return true;
            }
            catch {
                return false;
            }
        },
        read(account) {
            const path = pathFor(account);
            const inspected = inspectExistingFile(path);
            if ('kind' in inspected)
                return { kind: 'missing' };
            if (!inspected.ok) {
                return { kind: 'error', detail: `the stored login could not be trusted: ${inspected.detail}` };
            }
            let body;
            try {
                body = readFileSync(path, 'utf-8');
            }
            catch (error) {
                return { kind: 'error', detail: fileSystemDetail(error) };
            }
            try {
                const parsed = JSON.parse(body);
                // The parse error and the parsed content are both withheld on purpose:
                // whatever is in this file is either the token or something pretending to
                // be it, and neither belongs in a message.
                if (parsed.version !== FILE_FORMAT_VERSION) {
                    return { kind: 'error', detail: 'the stored login is in a format this version does not understand' };
                }
                if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) {
                    return { kind: 'error', detail: 'the stored login file is incomplete' };
                }
                return { kind: 'found', secret: parsed.secret };
            }
            catch {
                return { kind: 'error', detail: 'the stored login file is unreadable' };
            }
        },
        save(account, secret) {
            const directoryReady = ensureDirectory();
            if (!directoryReady.ok) {
                return { ok: false, detail: `a protected credential directory could not be created: ${directoryReady.detail}` };
            }
            const path = pathFor(account);
            const existing = inspectExistingFile(path);
            if (!('kind' in existing) && !existing.ok) {
                // Replacing it would destroy evidence of whatever put it there, and
                // renaming over a link or a directory has its own surprises.
                return { ok: false, detail: `an existing credential file could not be trusted: ${existing.detail}` };
            }
            // Same directory as the target, so `rename` stays within one filesystem and
            // is therefore atomic. `wx` guarantees the staging path is ours alone.
            const staging = join(directory, `.${process.pid}-${randomUUID()}.tmp`);
            const body = `${JSON.stringify({ version: FILE_FORMAT_VERSION, secret })}\n`;
            try {
                writeFileSync(staging, body, { encoding: 'utf-8', flag: 'wx', mode: FILE_MODE });
                // `mode` on open is masked by umask, so the protection is restated — and
                // on Windows this is where the ACL is applied, before any token is
                // reachable under the final name.
                const staged = protectPath(staging, 'file');
                if (!staged.ok) {
                    removeQuietly(staging);
                    return { ok: false, detail: `the credential file could not be protected: ${staged.detail}` };
                }
                renameSync(staging, path);
            }
            catch (error) {
                removeQuietly(staging);
                return { ok: false, detail: fileSystemDetail(error) };
            }
            // A rename preserves POSIX modes and NTFS ACLs, but the whole point of this
            // backend is that the protection is proven rather than assumed.
            const published = protectPath(path, 'file');
            if (!published.ok) {
                removeQuietly(path);
                return { ok: false, detail: `the credential file could not be protected: ${published.detail}` };
            }
            return { ok: true };
        },
        remove(account) {
            // Deliberately does not create the directory: `remove` runs on every
            // successful OS-backend write, and a logout on a healthy machine must not
            // leave a credential directory behind.
            removeQuietly(pathFor(account));
        },
    };
}
//# sourceMappingURL=fileCredentialStore.js.map