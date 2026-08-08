/**
 * OS-protected credential storage for the CLI.
 *
 * The CLI ships as a plain npm package, so a native addon (keytar and friends)
 * would add a build toolchain requirement to every install. Instead each
 * platform's own credential tool is driven as a subprocess:
 *
 *   macOS    `security`     (login keychain)
 *   Windows  `powershell`   (Windows.Security.Credentials.PasswordVault)
 *   Linux    `secret-tool`  (libsecret / Secret Service)
 *
 * When none of them is usable the store **refuses to persist**: nothing is
 * written to disk in plaintext, the secret is kept for this process only, and
 * the caller is told so it can point CI users at the long-lived `key_` path
 * instead. This mirrors `desktop/src/main/localAgent/credentialStore.ts`, which
 * declines to write when `safeStorage` is unavailable — the two must not drift.
 */
/** One keychain "service" groups every CLI credential under a single name. */
export declare const CREDENTIAL_SERVICE = "agentteams-cli";
export type CredentialBackendId = 'macos-keychain' | 'windows-credential-manager' | 'libsecret' | 'none';
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
    /** Masked backend error, present only once a write has actually failed. */
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
    status(): CredentialStoreStatus;
    read(account: string, options?: CredentialReadOptions): string | null;
    save(account: string, secret: string): CredentialSaveOutcome;
    remove(account: string): void;
}
export interface CreateCredentialStoreOptions {
    runner?: CommandRunner;
    platform?: NodeJS.Platform;
    service?: string;
}
export declare function isMissingItemStatus(backend: CredentialBackendId, status: number | null): boolean;
export declare function resolveBackendId(platform: NodeJS.Platform): CredentialBackendId;
/** Cheap "is this backend usable at all" call. Exit code 0 means yes. */
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
export declare function createCredentialStore(options?: CreateCredentialStoreOptions): CredentialStore;
/** Process-wide store. Tests build their own through {@link createCredentialStore}. */
export declare function getCredentialStore(): CredentialStore;
/** Test-only: drop the cached process-wide store. */
export declare function resetCredentialStoreForTests(): void;
//# sourceMappingURL=credentialStore.d.ts.map