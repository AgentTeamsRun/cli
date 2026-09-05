/**
 * Credential storage for the CLI: the OS store when it works, a protected file
 * when it does not.
 *
 * The CLI ships as a plain npm package, so a native addon (keytar and friends)
 * would add a build toolchain requirement to every install. Instead each
 * platform's own credential tool is driven as a subprocess:
 *
 *   macOS    `security`     (login keychain)
 *   Windows  `powershell`   (Windows.Security.Credentials.PasswordVault)
 *   Linux    `secret-tool`  (libsecret / Secret Service)
 *
 * Any of them can be unusable in a remote session, and the three fail at
 * different moments — Linux at the probe, macOS and Windows only once a write is
 * attempted. That is why the fallback in {@link createFileCredentialStore} is
 * triggered by **an OS backend failing**, never by the platform or by looking for
 * SSH environment variables: the platform does not predict the failure, and the
 * user-visible damage (a login approved on another device and then revoked) is
 * identical in all three cases.
 *
 * The OS store always wins where it works, and a value that had to go to a file
 * is promoted back into it only after a verified write. Setting
 * `AGENTTEAMS_DISABLE_FILE_CREDENTIALS` restores the previous behaviour for new
 * logins, in which an unusable OS store means the secret lives in this process
 * only. That older behaviour still mirrors
 * `desktop/src/main/localAgent/credentialStore.ts`, which declines to write when
 * `safeStorage` is unavailable. The opt-out never hides a file this CLI already
 * wrote — reading and removing one stay possible, so `logout` can still revoke it.
 */
/** One keychain "service" groups every CLI credential under a single name. */
export declare const CREDENTIAL_SERVICE = "agentteams-cli";
export type CredentialBackendId = 'macos-keychain' | 'windows-credential-manager' | 'libsecret'
/** Permission-protected file under `~/.agentteams/credentials`. */
 | 'protected-file' | 'none';
/**
 * Why the store can (or cannot) persist.
 *
 * `WRITE_FAILED` is the one that is only knowable after trying: the probe below
 * is deliberately cheap, so a locked macOS keychain ("User interaction is not
 * allowed") or a Linux box with `secret-tool` installed but no Secret Service
 * daemon running still reports `OK` until the first write is attempted.
 */
export type CredentialStoreReason = 'OK' | 'NO_BACKEND' | 'UNSUPPORTED_PLATFORM' | 'WRITE_FAILED';
export interface CredentialStoreStatus {
    backend: CredentialBackendId;
    /** false → nothing is ever written to disk; the secret lives in this process only. */
    persisted: boolean;
    reason: CredentialStoreReason;
    /**
     * Why this backend, in the user's words. Masked before it is set, so it never
     * carries a secret.
     *
     * Two things end up here: the error from a write the OS store rejected, and —
     * when `backend` is `protected-file` — why the OS store was not used at all.
     * The second is the only place a user can learn that their `secret-tool` is
     * installed but cannot be started, which is otherwise indistinguishable from
     * not having installed it.
     */
    detail?: string;
}
export interface CredentialSaveOutcome {
    persisted: boolean;
    reason: CredentialStoreReason;
    /** Masked backend error, present only when `reason` is `WRITE_FAILED`. */
    detail?: string;
}
export interface CommandResult {
    /** null when the executable could not be spawned at all. */
    status: number | null;
    stdout: string;
    stderr: string;
}
export interface CredentialCommand {
    command: string;
    args: string[];
    /** Written to the child's stdin. Never placed on argv — argv is world-readable via `ps`. */
    input?: string;
    /** Extra environment for the child. Used on Windows so the secret stays off argv. */
    env?: Record<string, string>;
    /**
     * Run the child in its own session, with no controlling terminal.
     *
     * Required for any tool that reads a secret from stdin: macOS `security`
     * collects the password with `readpassphrase(3)`, which opens the controlling
     * terminal in preference to stdin and only falls back to stdin when there is
     * none to open. Piping the token in therefore works from a script or a test but is
     * silently ignored in an interactive shell, where `security` prompts the user
     * instead and stores whatever the terminal happened to supply. Detaching
     * removes the terminal, so the piped value is the only thing it can read.
     */
    detachTerminal?: boolean;
}
export type CommandRunner = (command: CredentialCommand) => CommandResult;
export interface CredentialReadOptions {
    /**
     * Skip the process-lifetime read cache and ask the backend again.
     *
     * Required before presenting a **rotating** credential: another process may
     * have rotated it since this one first read it, and the cached copy would then
     * be a superseded token the server treats as reuse.
     *
     * Fails closed — if the backend cannot be read, the call returns null rather
     * than the cached guess, because the caller is about to present the value
     * somewhere that punishes staleness. Ignored for an account whose only copy is
     * in memory (a write that could not be persisted), since there the cache *is*
     * the credential.
     */
    fresh?: boolean;
}
export interface CredentialStore {
    /**
     * @param account - Report where *this* slot's credential actually lives.
     *   Omitted, the answer is the store-wide "can anything be persisted here",
     *   which is what a login preflight needs before there is a slot to ask about.
     */
    status(account?: string): CredentialStoreStatus;
    read(account: string, options?: CredentialReadOptions): string | null;
    save(account: string, secret: string): CredentialSaveOutcome;
    remove(account: string): void;
}
export interface CreateCredentialStoreOptions {
    runner?: CommandRunner;
    platform?: NodeJS.Platform;
    service?: string;
    /** Home directory the file fallback lives under. Defaults to `os.homedir()`. */
    homeDir?: string;
    /** Consulted for `AGENTTEAMS_DISABLE_FILE_CREDENTIALS` and the Windows account name. */
    env?: NodeJS.ProcessEnv;
}
export declare function isMissingItemStatus(backend: CredentialBackendId, status: number | null): boolean;
export declare function resolveBackendId(platform: NodeJS.Platform): CredentialBackendId;
/**
 * Cheap "can this backend be driven at all" call. Exit code 0 means yes.
 *
 * Deliberately not a durability test. None of the three probes can prove a write
 * would land: `security list-keychains` says nothing about whether the login
 * keychain is unlocked, the PowerShell probe never touches the vault, and
 * `secret-tool --version` says nothing about a Secret Service being on the bus.
 * That is by design — the write itself, verified by reading the value back in
 * {@link createCredentialStore}, is what decides persistence, and a probe that
 * tried to be authoritative would have to write a secret to find out.
 */
export declare function buildProbeCommand(backend: CredentialBackendId): CredentialCommand | null;
export declare function buildReadCommand(backend: CredentialBackendId, service: string, account: string): CredentialCommand | null;
export declare function buildSaveCommand(backend: CredentialBackendId, service: string, account: string, secret: string): CredentialCommand | null;
export declare function buildRemoveCommand(backend: CredentialBackendId, service: string, account: string): CredentialCommand | null;
/**
 * Strip a secret out of anything that is about to be surfaced.
 *
 * Backend tools do not normally echo the value back, but "normally" is not a
 * guarantee worth betting a token on — and this store is the last boundary
 * before text reaches a log or an error message.
 */
export declare function maskSecret(text: string, secret: string): string;
/**
 * Join the OS-side and file-side reasons a save had nowhere to go.
 *
 * Neither one alone is the answer once both backends are out: the OS reason is
 * what the user already suspects, and the file reason is the one thing that
 * explains why the fallback this CLI advertises did not stand in.
 */
export declare function combineDetails(osDetail?: string, fileDetail?: string): string | undefined;
/**
 * Turn a failed probe into advice.
 *
 * "No usable OS credential store" sent Linux users to `apt install
 * libsecret-tools` even when it was already installed, because a tool that is
 * present but exits non-zero looked exactly like a tool that is absent. The two
 * need different next steps, and only the exit status tells them apart:
 * `status: null` is "could not be spawned", anything else is "ran and refused".
 */
export declare function describeProbeFailure(command: CredentialCommand, result: CommandResult): string;
export declare function createCredentialStore(options?: CreateCredentialStoreOptions): CredentialStore;
/** Process-wide store. Tests build their own through {@link createCredentialStore}. */
export declare function getCredentialStore(): CredentialStore;
/** Test-only: drop the cached process-wide store. */
export declare function resetCredentialStoreForTests(): void;
//# sourceMappingURL=credentialStore.d.ts.map