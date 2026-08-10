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

import { spawnSync } from 'node:child_process';
import {
  FILE_CREDENTIAL_BACKEND,
  createFileCredentialStore,
  isFileCredentialFallbackDisabled,
  type FileCredentialStore,
} from './fileCredentialStore.js';

/** One keychain "service" groups every CLI credential under a single name. */
export const CREDENTIAL_SERVICE = 'agentteams-cli';

export type CredentialBackendId =
  | 'macos-keychain'
  | 'windows-credential-manager'
  | 'libsecret'
  /** Permission-protected file under `~/.agentteams/credentials`. */
  | 'protected-file'
  | 'none';

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

function powershellCommand(script: string, env?: Record<string, string>): CredentialCommand {
  const command: CredentialCommand = {
    command: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-Command', `${WINDOWS_PREAMBLE}; ${script}`],
  };
  if (env) command.env = env;
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
const MISSING_ITEM_STATUS: Partial<Record<CredentialBackendId, readonly number[]>> = {
  'macos-keychain': [44],
  libsecret: [1],
};

export function isMissingItemStatus(backend: CredentialBackendId, status: number | null): boolean {
  if (status === null) return false;
  // PasswordVault throws for a missing item and PowerShell turns that into 1;
  // there is no separate code to key on, so it is treated as absence.
  if (backend === 'windows-credential-manager') return status === 1;
  return (MISSING_ITEM_STATUS[backend] ?? []).includes(status);
}

export function resolveBackendId(platform: NodeJS.Platform): CredentialBackendId {
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
export function buildProbeCommand(backend: CredentialBackendId): CredentialCommand | null {
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

export function buildReadCommand(
  backend: CredentialBackendId,
  service: string,
  account: string,
): CredentialCommand | null {
  switch (backend) {
    case 'macos-keychain':
      return { command: 'security', args: ['find-generic-password', '-a', account, '-s', service, '-w'] };
    case 'libsecret':
      return { command: 'secret-tool', args: ['lookup', 'service', service, 'account', account] };
    case 'windows-credential-manager':
      return powershellCommand(
        `$c = $vault.Retrieve($env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}); ` +
          '$c.RetrievePassword(); [Console]::Out.Write($c.Password)',
        { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account },
      );
    default:
      return null;
  }
}

export function buildSaveCommand(
  backend: CredentialBackendId,
  service: string,
  account: string,
  secret: string,
): CredentialCommand | null {
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
      return powershellCommand(
        '$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential(' +
          `$env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}, $env:${WINDOWS_SECRET_ENV})))`,
        { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account, [WINDOWS_SECRET_ENV]: secret },
      );
    default:
      return null;
  }
}

export function buildRemoveCommand(
  backend: CredentialBackendId,
  service: string,
  account: string,
): CredentialCommand | null {
  switch (backend) {
    case 'macos-keychain':
      return { command: 'security', args: ['delete-generic-password', '-a', account, '-s', service] };
    case 'libsecret':
      return { command: 'secret-tool', args: ['clear', 'service', service, 'account', account] };
    case 'windows-credential-manager':
      return powershellCommand(
        `$c = $vault.Retrieve($env:${WINDOWS_SERVICE_ENV}, $env:${WINDOWS_ACCOUNT_ENV}); $vault.Remove($c)`,
        { [WINDOWS_SERVICE_ENV]: service, [WINDOWS_ACCOUNT_ENV]: account },
      );
    default:
      return null;
  }
}

const defaultRunner: CommandRunner = (command) => {
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
export function maskSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

/**
 * Join the OS-side and file-side reasons a save had nowhere to go.
 *
 * Neither one alone is the answer once both backends are out: the OS reason is
 * what the user already suspects, and the file reason is the one thing that
 * explains why the fallback this CLI advertises did not stand in.
 */
export function combineDetails(osDetail?: string, fileDetail?: string): string | undefined {
  if (!osDetail) return fileDetail;
  if (!fileDetail) return osDetail;
  return `${osDetail}; the protected-file fallback also failed: ${fileDetail}`;
}

/**
 * Turn a failed probe into advice.
 *
 * "No usable OS credential store" sent Linux users to `apt install
 * libsecret-tools` even when it was already installed, because a tool that is
 * present but exits non-zero looked exactly like a tool that is absent. The two
 * need different next steps, and only the exit status tells them apart:
 * `status: null` is "could not be spawned", anything else is "ran and refused".
 */
export function describeProbeFailure(command: CredentialCommand, result: CommandResult): string {
  if (result.status === null) {
    return `${command.command} could not be started on this machine`;
  }
  const stderr = result.stderr.trim().split(/\r?\n/)[0] ?? '';
  const suffix = stderr ? `: ${stderr}` : '';
  return `${command.command} exited with status ${result.status} during the availability check${suffix}`;
}

export function createCredentialStore(options: CreateCredentialStoreOptions = {}): CredentialStore {
  const runner = options.runner ?? defaultRunner;
  const platform = options.platform ?? process.platform;
  const service = options.service ?? CREDENTIAL_SERVICE;
  const env = options.env ?? process.env;
  const backend = resolveBackendId(platform);

  /**
   * The fallback.
   *
   * Always constructed, even under the opt-out: building it is free — nothing is
   * created on disk until something asks whether it is usable, and nothing asks
   * while the OS backend is working.
   */
  const fileStore: FileCredentialStore = createFileCredentialStore({
    platform,
    runner,
    env,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
  });

  /**
   * Whether a *new* secret may go to a file.
   *
   * The opt-out stops here and goes no further. Making it hide the store
   * outright would mean a machine that had already fallen back could no longer
   * see its own credential file: `logout` would report nothing to revoke and
   * delete nothing, leaving a live refresh token on disk that the CLI can never
   * reach again — and reads would quietly fall through to whatever older value
   * the OS store still had.
   */
  const fileWritesAllowed = !isFileCredentialFallbackDisabled(env);

  /**
   * Whether this slot's authoritative copy is the file one.
   *
   * Cheap on the healthy path (one `lstat` that finds nothing) and, critically,
   * decided by what is actually on disk rather than by which backend answered
   * first. A file copy only exists because an OS write failed, so it is by
   * construction at least as new as anything the OS store still holds — and
   * presenting the older one would be refresh-token reuse, which the server
   * answers by revoking the whole family.
   *
   * The directory check is the non-creating one: the file's own protection is
   * verified on every read anyway, and a directory question that answered "no"
   * here would send the caller to the OS store's stale copy instead of failing.
   */
  const fileHolds = (account: string): boolean => fileStore.has(account) && fileStore.check({ create: false }).ok;

  /**
   * Session-only fallback, and a read cache on top of a working backend.
   * A one-shot command barely benefits, but `agentteams mcp` runs for hours and
   * would otherwise re-shell out on every credential resolution.
   */
  const memory = new Map<string, string>();
  /**
   * Accounts whose only copy is in {@link memory}, because a write could not be
   * persisted. Tracked per account rather than as one store-wide latch: one
   * account's failed write says nothing about another's, and a store-wide flag
   * would silently turn every later `{ fresh: true }` read back into a cache hit.
   */
  const memoryOnlyAccounts = new Set<string>();
  let availability: boolean | null = null;
  /** Why the probe said no, kept so the fallback can explain itself. */
  let probeFailureDetail: string | null = null;
  /**
   * Set once a write is rejected by a backend that passed the probe. From then
   * on `status()` tells the truth — "this store looks present but will not keep
   * anything" — instead of promising a durability it has already failed to give.
   */
  let writeFailureDetail: string | null = null;

  const isAvailable = (): boolean => {
    if (availability !== null) return availability;

    const probe = buildProbeCommand(backend);
    if (!probe) {
      availability = false;
      return availability;
    }

    // A backend that cannot even be probed is treated as absent rather than as
    // an error: the caller's job is to fall back, not to fail the command.
    const result = runner(probe);
    availability = result.status === 0;
    probeFailureDetail = availability ? null : describeProbeFailure(probe, result);
    return availability;
  };

  /** What the OS backend alone would report — the contract before the fallback. */
  const osStatus = (): CredentialStoreStatus => {
    if (backend === 'none') {
      return { backend, persisted: false, reason: 'UNSUPPORTED_PLATFORM' };
    }
    if (writeFailureDetail !== null) {
      return { backend, persisted: false, reason: 'WRITE_FAILED', detail: writeFailureDetail };
    }
    const available = isAvailable();
    if (available) return { backend, persisted: true, reason: 'OK' };
    return {
      backend,
      persisted: false,
      reason: 'NO_BACKEND',
      ...(probeFailureDetail === null ? {} : { detail: probeFailureDetail }),
    };
  };

  const fileStatus = (osReason: CredentialStoreStatus): CredentialStoreStatus => ({
    backend: FILE_CREDENTIAL_BACKEND,
    persisted: true,
    reason: 'OK',
    // Carrying the OS-side reason forward is what lets `auth status` say *why*
    // the weaker backend is in play instead of leaving it looking like a choice —
    // but only while this process holds that reason. It comes from the probe or
    // from a rejected write, both process-local, so a later `auth status` on
    // macOS or Windows (where the probe passes) reports the backend with no
    // reason attached. Linux, whose probe fails outright, always has one.
    ...(osReason.detail === undefined ? {} : { detail: osReason.detail }),
  });

  const status = (account?: string): CredentialStoreStatus => {
    const os = osStatus();
    // A slot whose copy is in a file is in a file, even on a machine whose OS
    // store works again — and even under the opt-out, which forbids new writes
    // rather than disowning what is already there. Reporting the keychain here
    // would describe a token that is not there.
    if (account !== undefined && fileHolds(account)) return fileStatus(os);
    if (os.reason === 'OK') return os;
    if (!fileWritesAllowed) return os;

    // Read-only: `status` is asked by `auth status` and by the login preflight,
    // neither of which may leave a credential directory behind.
    const fileReady = fileStore.check({ create: false });
    if (fileReady.ok) return fileStatus(os);

    // Both backends are out, so both reasons matter: the caller is about to tell
    // the user why a login cannot be saved, and the file-side half is the only
    // half that is new.
    const detail = combineDetails(os.detail, fileReady.detail);
    return detail === undefined ? os : { ...os, detail };
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
  const readFromOsBackend = (
    account: string,
  ): { kind: 'found'; secret: string } | { kind: 'missing' } | { kind: 'error'; detail: string } => {
    if (!isAvailable()) return { kind: 'error', detail: 'the credential store is not available' };

    const command = buildReadCommand(backend, service, account);
    if (!command) return { kind: 'error', detail: 'no read command for this backend' };

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

  /**
   * Whichever backend actually holds this slot.
   *
   * No fall-through from a file error to the OS store. A file that exists but
   * cannot be trusted means the authoritative copy is unreadable, and answering
   * with the OS store's older value would present a superseded refresh token —
   * reuse, which the server punishes by revoking the whole family.
   */
  const readFromBackend = (
    account: string,
  ): { kind: 'found'; secret: string } | { kind: 'missing' } | { kind: 'error'; detail: string } => {
    if (fileHolds(account)) return fileStore.read(account);
    return readFromOsBackend(account);
  };

  return {
    status,

    read(account, options) {
      const cached = memory.get(account);
      // A re-read only makes sense when the backend, not memory, holds the
      // authoritative copy for this account. Where a write could not be
      // persisted, memory is the only copy there is and consulting the backend
      // would throw the live credential away.
      const reread =
        options?.fresh === true && (fileHolds(account) || isAvailable()) && !memoryOnlyAccounts.has(account);
      if (cached !== undefined && !reread) return cached;

      const outcome = readFromBackend(account);
      if (outcome.kind === 'found') {
        memory.set(account, outcome.secret);
        return outcome.secret;
      }

      // Only a definite absence means another process removed the credential; a
      // read that merely failed says nothing, so the cached copy stays.
      if (outcome.kind === 'missing' && reread) memory.delete(account);

      // Either way this call cannot vouch for what the backend holds. A caller
      // that asked for a fresh value is about to present it somewhere that
      // punishes staleness, so it gets nothing rather than the cached guess.
      if (reread) return null;
      return cached ?? null;
    },

    save(account, secret) {
      memory.set(account, secret);

      const markMemoryOnly = (reason: CredentialStoreReason, detail?: string): CredentialSaveOutcome => {
        memoryOnlyAccounts.add(account);
        return detail === undefined ? { persisted: false, reason } : { persisted: false, reason, detail };
      };

      /**
       * Last resort before giving up on persistence.
       *
       * Only ever reached once the OS backend has already failed, so it can never
       * demote a machine whose keychain works.
       */
      const saveToFile = (reason: CredentialStoreReason, detail?: string): CredentialSaveOutcome => {
        if (!fileWritesAllowed) return markMemoryOnly(reason, detail);

        // Both halves are carried, never one instead of the other: the OS-side
        // reason alone reads as "your keychain is locked" on a machine where the
        // real blocker is a read-only home directory the fallback could not use.
        const ready = fileStore.check();
        if (!ready.ok) return markMemoryOnly(reason, combineDetails(detail, ready.detail));

        const written = fileStore.save(account, secret);
        if (written.ok) {
          memoryOnlyAccounts.delete(account);
          return { persisted: true, reason: 'OK' };
        }
        return markMemoryOnly(reason, combineDetails(detail, written.detail));
      };

      if (!isAvailable()) {
        return saveToFile(backend === 'none' ? 'UNSUPPORTED_PLATFORM' : 'NO_BACKEND', probeFailureDetail ?? undefined);
      }

      const command = buildSaveCommand(backend, service, account, secret);
      if (!command) {
        return saveToFile('NO_BACKEND');
      }

      const result = runner(command);
      if (result.status !== 0) {
        // Never thrown: the caller's contract is "you may not get persistence",
        // and a rejected write is just another way of not getting it. Throwing
        // here would kill the documented fallback at the exact moment it is
        // needed — and on macOS and Windows this is the *only* point at which the
        // failure is detectable, since both probes pass in a session that cannot
        // write.
        writeFailureDetail = maskSecret(`${result.stderr}`.trim(), secret) || 'the credential store rejected the write';
        return saveToFile('WRITE_FAILED', writeFailureDetail);
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
      const stored = readFromOsBackend(account);
      if (stored.kind === 'error') {
        writeFailureDetail = `the write could not be verified: ${stored.detail}`;
        return saveToFile('WRITE_FAILED', writeFailureDetail);
      }
      if (stored.kind === 'missing' || stored.secret !== secret) {
        writeFailureDetail = 'the credential store did not keep the value that was written';
        return saveToFile('WRITE_FAILED', writeFailureDetail);
      }

      // The OS store has the value and has proved it by handing it back — and
      // only now is the file copy redundant. Dropping it any earlier (on a zero
      // exit, say) would delete the one usable copy of a token whose OS write
      // silently stored nothing.
      fileStore.remove(account);

      writeFailureDetail = null;
      memoryOnlyAccounts.delete(account);
      return { persisted: true, reason: 'OK' };
    },

    remove(account) {
      memory.delete(account);
      // Both copies, unconditionally — including under the opt-out, which stops
      // new writes and not this: a logout that cleared only the backend it
      // happens to prefer today would leave a live refresh token behind.
      fileStore.remove(account);
      if (!isAvailable()) return;

      const command = buildRemoveCommand(backend, service, account);
      if (!command) return;

      // Removing something that is already gone is success as far as the caller
      // is concerned, so a non-zero status is not escalated.
      runner(command);
    },
  };
}

let sharedStore: CredentialStore | null = null;

/** Process-wide store. Tests build their own through {@link createCredentialStore}. */
export function getCredentialStore(): CredentialStore {
  if (!sharedStore) {
    sharedStore = createCredentialStore();
  }
  return sharedStore;
}

/** Test-only: drop the cached process-wide store. */
export function resetCredentialStoreForTests(): void {
  sharedStore = null;
}
