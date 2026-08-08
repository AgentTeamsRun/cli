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
import { spawnSync } from 'node:child_process';
/** One keychain "service" groups every CLI credential under a single name. */
export const CREDENTIAL_SERVICE = 'agentteams-cli';
const WINDOWS_SERVICE_ENV = 'AGENTTEAMS_CREDENTIAL_SERVICE';
const WINDOWS_ACCOUNT_ENV = 'AGENTTEAMS_CREDENTIAL_ACCOUNT';
const WINDOWS_SECRET_ENV = 'AGENTTEAMS_CREDENTIAL_SECRET';
/**
 * PasswordVault is WinRT, so it is projected into PowerShell rather than called
 * directly. Every script starts from the same preamble; the caller appends the
 * operation. Inputs arrive through the environment because a PowerShell command
 * line is as visible as any other argv.
 */
const WINDOWS_PREAMBLE = [
    '$ErrorActionPreference = "Stop"',
    '[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]',
    '$vault = New-Object Windows.Security.Credentials.PasswordVault',
].join('; ');
function powershellCommand(script, env) {
    const command = {
        command: 'powershell',
        args: ['-NoProfile', '-NonInteractive', '-Command', `${WINDOWS_PREAMBLE}; ${script}`],
    };
    if (env)
        command.env = env;
    return command;
}
/**
 * Exit statuses that mean "no such item" rather than "the read failed".
 *
 * `security` answers a missing generic password with 44 (errSecItemNotFound);
 * `secret-tool lookup` exits 1 with no output. Anything else — a locked keychain,
 * a denied access prompt, a dead Secret Service — is an error, and must not be
 * mistaken for the credential having been removed.
 */
const MISSING_ITEM_STATUS = {
    'macos-keychain': [44],
    libsecret: [1],
};
export function isMissingItemStatus(backend, status) {
    if (status === null)
        return false;
    // PasswordVault throws for a missing item and PowerShell turns that into 1;
    // there is no separate code to key on, so it is treated as absence.
    if (backend === 'windows-credential-manager')
        return status === 1;
    return (MISSING_ITEM_STATUS[backend] ?? []).includes(status);
}
export function resolveBackendId(platform) {
    switch (platform) {
        case 'darwin':
            return 'macos-keychain';
        case 'win32':
            return 'windows-credential-manager';
        case 'linux':
            return 'libsecret';
        default:
            return 'none';
    }
}
/** Cheap "is this backend usable at all" call. Exit code 0 means yes. */
export function buildProbeCommand(backend) {
    switch (backend) {
        case 'macos-keychain':
            return { command: 'security', args: ['list-keychains'] };
        case 'libsecret':
            return { command: 'secret-tool', args: ['--version'] };
        case 'windows-credential-manager':
            return powershellCommand('exit 0');
        default:
            return null;
    }
}
export function buildReadCommand(backend, service, account) {
    switch (backend) {
        case 'macos-keychain':
            return { command: 'security', args: ['find-generic-password', '-a', account, '-s', service, '-w'] };
        case 'libsecret':
            return { command: 'secret-tool', args: ['lookup', 'service', service, 'account', account] };
        case 'windows-credential-manager':
            return powershellCommand(`$c = $vault.Retrieve($env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}); ` +
                '$c.RetrievePassword(); [Console]::Out.Write($c.Password)', { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account });
        default:
            return null;
    }
}
export function buildSaveCommand(backend, service, account, secret) {
    switch (backend) {
        case 'macos-keychain':
            // `-w` without a value makes `security` read the password rather than take
            // it from argv, where `ps` would expose it. It asks twice ("retype
            // password"), so the value is written twice. `detachTerminal` is what makes
            // it read *this* stdin instead of prompting the user's terminal.
            return {
                command: 'security',
                args: ['add-generic-password', '-a', account, '-s', service, '-U', '-w'],
                input: `${secret}\n${secret}\n`,
                detachTerminal: true,
            };
        case 'libsecret':
            return {
                command: 'secret-tool',
                args: ['store', '--label', `${service} (${account})`, 'service', service, 'account', account],
                input: secret,
            };
        case 'windows-credential-manager':
            return powershellCommand('$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential(' +
                `$env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}, $env:${WINDOWS_SECRET_ENV})))`, { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account, [WINDOWS_SECRET_ENV]: secret });
        default:
            return null;
    }
}
export function buildRemoveCommand(backend, service, account) {
    switch (backend) {
        case 'macos-keychain':
            return { command: 'security', args: ['delete-generic-password', '-a', account, '-s', service] };
        case 'libsecret':
            return { command: 'secret-tool', args: ['clear', 'service', service, 'account', account] };
        case 'windows-credential-manager':
            return powershellCommand(`$c = $vault.Retrieve($env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}); $vault.Remove($c)`, { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account });
        default:
            return null;
    }
}
const defaultRunner = (command) => {
    const result = spawnSync(command.command, command.args, {
        encoding: 'utf-8',
        input: command.input,
        windowsHide: true,
        env: command.env ? { ...process.env, ...command.env } : process.env,
        // `spawnSync` still waits for the child, so detaching only changes which
        // session it belongs to — there is nothing left running afterwards.
        ...(command.detachTerminal ? { detached: true } : {}),
    });
    return {
        status: result.error ? null : result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
};
/**
 * Strip a secret out of anything that is about to be surfaced.
 *
 * Backend tools do not normally echo the value back, but "normally" is not a
 * guarantee worth betting a token on — and this store is the last boundary
 * before text reaches a log or an error message.
 */
export function maskSecret(text, secret) {
    if (!secret)
        return text;
    return text.split(secret).join('***');
}
export function createCredentialStore(options = {}) {
    const runner = options.runner ?? defaultRunner;
    const platform = options.platform ?? process.platform;
    const service = options.service ?? CREDENTIAL_SERVICE;
    const backend = resolveBackendId(platform);
    /**
     * Session-only fallback, and a read cache on top of a working backend.
     * A one-shot command barely benefits, but `agentteams mcp` runs for hours and
     * would otherwise re-shell out on every credential resolution.
     */
    const memory = new Map();
    /**
     * Accounts whose only copy is in {@link memory}, because a write could not be
     * persisted. Tracked per account rather than as one store-wide latch: one
     * account's failed write says nothing about another's, and a store-wide flag
     * would silently turn every later `{ fresh: true }` read back into a cache hit.
     */
    const memoryOnlyAccounts = new Set();
    let availability = null;
    /**
     * Set once a write is rejected by a backend that passed the probe. From then
     * on `status()` tells the truth — "this store looks present but will not keep
     * anything" — instead of promising a durability it has already failed to give.
     */
    let writeFailureDetail = null;
    const isAvailable = () => {
        if (availability !== null)
            return availability;
        const probe = buildProbeCommand(backend);
        if (!probe) {
            availability = false;
            return availability;
        }
        // A backend that cannot even be probed is treated as absent rather than as
        // an error: the caller's job is to fall back, not to fail the command.
        availability = runner(probe).status === 0;
        return availability;
    };
    const status = () => {
        if (backend === 'none') {
            return { backend, persisted: false, reason: 'UNSUPPORTED_PLATFORM' };
        }
        if (writeFailureDetail !== null) {
            return { backend, persisted: false, reason: 'WRITE_FAILED', detail: writeFailureDetail };
        }
        const available = isAvailable();
        return { backend, persisted: available, reason: available ? 'OK' : 'NO_BACKEND' };
    };
    /**
     * The backend's own answer, with no memory cache in front of it.
     *
     * `missing` and `error` must stay apart. Collapsing them makes a locked
     * keychain or a denied access prompt look exactly like "another process logged
     * out", which would drop a live credential from the cache and let `logout`
     * claim there is nothing to revoke while a valid refresh token sits in the
     * store.
     */
    const readFromBackend = (account) => {
        if (!isAvailable())
            return { kind: 'error', detail: 'the credential store is not available' };
        const command = buildReadCommand(backend, service, account);
        if (!command)
            return { kind: 'error', detail: 'no read command for this backend' };
        const result = runner(command);
        if (result.status !== 0) {
            return isMissingItemStatus(backend, result.status)
                ? { kind: 'missing' }
                : { kind: 'error', detail: `${result.stderr}`.trim() || `the credential store read failed (${result.status})` };
        }
        // `security -w` and `secret-tool lookup` both terminate the value with a
        // newline; a token never legitimately ends in whitespace.
        const secret = result.stdout.replace(/\r?\n$/, '');
        return secret.length === 0 ? { kind: 'missing' } : { kind: 'found', secret };
    };
    return {
        status,
        read(account, options) {
            const cached = memory.get(account);
            // A re-read only makes sense when the backend, not memory, holds the
            // authoritative copy for this account. Where a write could not be
            // persisted, memory is the only copy there is and consulting the backend
            // would throw the live credential away.
            const reread = options?.fresh === true && isAvailable() && !memoryOnlyAccounts.has(account);
            if (cached !== undefined && !reread)
                return cached;
            const outcome = readFromBackend(account);
            if (outcome.kind === 'found') {
                memory.set(account, outcome.secret);
                return outcome.secret;
            }
            // Only a definite absence means another process removed the credential; a
            // read that merely failed says nothing, so the cached copy stays.
            if (outcome.kind === 'missing' && reread)
                memory.delete(account);
            // Either way this call cannot vouch for what the backend holds. A caller
            // that asked for a fresh value is about to present it somewhere that
            // punishes staleness, so it gets nothing rather than the cached guess.
            if (reread)
                return null;
            return cached ?? null;
        },
        save(account, secret) {
            memory.set(account, secret);
            const markMemoryOnly = (reason, detail) => {
                memoryOnlyAccounts.add(account);
                return detail === undefined ? { persisted: false, reason } : { persisted: false, reason, detail };
            };
            if (!isAvailable()) {
                return markMemoryOnly(backend === 'none' ? 'UNSUPPORTED_PLATFORM' : 'NO_BACKEND');
            }
            const command = buildSaveCommand(backend, service, account, secret);
            if (!command) {
                return markMemoryOnly('NO_BACKEND');
            }
            const result = runner(command);
            if (result.status !== 0) {
                // Never thrown: the caller's contract is "you may not get persistence",
                // and a rejected write is just another way of not getting it. Throwing
                // here would kill the documented session-only fallback at the exact
                // moment it is needed.
                writeFailureDetail = maskSecret(`${result.stderr}`.trim(), secret) || 'the credential store rejected the write';
                return markMemoryOnly('WRITE_FAILED', writeFailureDetail);
            }
            // A zero exit is not proof the value landed. A backend tool that collects
            // the secret interactively can store something else entirely and still
            // succeed, and the caller would then commit to a credential that is only
            // discovered to be wrong when the server rejects it — as an expired login,
            // which sends the user back to a re-login that fails the same way. Reading
            // it back turns that silent corruption into an honest WRITE_FAILED.
            //
            // A read that fails is not evidence either way, so it is not treated as a
            // mismatch: doing so would revoke a token that did store, on nothing more
            // than a locked keychain.
            const stored = readFromBackend(account);
            if (stored.kind === 'error') {
                writeFailureDetail = `the write could not be verified: ${stored.detail}`;
                return markMemoryOnly('WRITE_FAILED', writeFailureDetail);
            }
            if (stored.kind === 'missing' || stored.secret !== secret) {
                writeFailureDetail = 'the credential store did not keep the value that was written';
                return markMemoryOnly('WRITE_FAILED', writeFailureDetail);
            }
            writeFailureDetail = null;
            memoryOnlyAccounts.delete(account);
            return { persisted: true, reason: 'OK' };
        },
        remove(account) {
            memory.delete(account);
            if (!isAvailable())
                return;
            const command = buildRemoveCommand(backend, service, account);
            if (!command)
                return;
            // Removing something that is already gone is success as far as the caller
            // is concerned, so a non-zero status is not escalated.
            runner(command);
        },
    };
}
let sharedStore = null;
/** Process-wide store. Tests build their own through {@link createCredentialStore}. */
export function getCredentialStore() {
    if (!sharedStore) {
        sharedStore = createCredentialStore();
    }
    return sharedStore;
}
/** Test-only: drop the cached process-wide store. */
export function resetCredentialStoreForTests() {
    sharedStore = null;
}
//# sourceMappingURL=credentialStore.js.map