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
}

export type CommandRunner = (command: CredentialCommand) => CommandResult;

export interface CredentialStore {
  status(): CredentialStoreStatus;
  read(account: string): string | null;
  save(account: string, secret: string): CredentialSaveOutcome;
  remove(account: string): void;
}

export interface CreateCredentialStoreOptions {
  runner?: CommandRunner;
  platform?: NodeJS.Platform;
  service?: string;
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

/** Cheap "is this backend usable at all" call. Exit code 0 means yes. */
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
      // `-w` without a value makes `security` read the password from stdin, and
      // it asks for it twice ("retype password"), so the value is written twice.
      // Passing `-w <secret>` instead would expose the token on argv.
      return {
        command: 'security',
        args: ['add-generic-password', '-a', account, '-s', service, '-U', '-w'],
        input: `${secret}\n${secret}\n`,
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

export function createCredentialStore(options: CreateCredentialStoreOptions = {}): CredentialStore {
  const runner = options.runner ?? defaultRunner;
  const platform = options.platform ?? process.platform;
  const service = options.service ?? CREDENTIAL_SERVICE;
  const backend = resolveBackendId(platform);

  /**
   * Session-only fallback, and a read cache on top of a working backend.
   * A one-shot command barely benefits, but `agentteams mcp` runs for hours and
   * would otherwise re-shell out on every credential resolution.
   */
  const memory = new Map<string, string>();
  let availability: boolean | null = null;
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
    availability = runner(probe).status === 0;
    return availability;
  };

  const status = (): CredentialStoreStatus => {
    if (backend === 'none') {
      return { backend, persisted: false, reason: 'UNSUPPORTED_PLATFORM' };
    }
    if (writeFailureDetail !== null) {
      return { backend, persisted: false, reason: 'WRITE_FAILED', detail: writeFailureDetail };
    }
    const available = isAvailable();
    return { backend, persisted: available, reason: available ? 'OK' : 'NO_BACKEND' };
  };

  return {
    status,

    read(account) {
      const cached = memory.get(account);
      if (cached !== undefined) return cached;
      if (!isAvailable()) return null;

      const command = buildReadCommand(backend, service, account);
      if (!command) return null;

      const result = runner(command);
      // A missing item (`security` 44, `secret-tool` 1) and a broken backend
      // both mean the same thing to the caller: there is no credential to use.
      if (result.status !== 0) return null;

      // `security -w` and `secret-tool lookup` both terminate the value with a
      // newline; a token never legitimately ends in whitespace.
      const secret = result.stdout.replace(/\r?\n$/, '');
      if (secret.length === 0) return null;

      memory.set(account, secret);
      return secret;
    },

    save(account, secret) {
      memory.set(account, secret);

      if (!isAvailable()) {
        return { persisted: false, reason: backend === 'none' ? 'UNSUPPORTED_PLATFORM' : 'NO_BACKEND' };
      }

      const command = buildSaveCommand(backend, service, account, secret);
      if (!command) {
        return { persisted: false, reason: 'NO_BACKEND' };
      }

      const result = runner(command);
      if (result.status !== 0) {
        // Never thrown: the caller's contract is "you may not get persistence",
        // and a rejected write is just another way of not getting it. Throwing
        // here would kill the documented session-only fallback at the exact
        // moment it is needed.
        writeFailureDetail = maskSecret(`${result.stderr}`.trim(), secret) || 'the credential store rejected the write';
        return { persisted: false, reason: 'WRITE_FAILED', detail: writeFailureDetail };
      }

      writeFailureDetail = null;
      return { persisted: true, reason: 'OK' };
    },

    remove(account) {
      memory.delete(account);
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
