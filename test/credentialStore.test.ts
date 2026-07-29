import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import {
  CREDENTIAL_SERVICE,
  buildReadCommand,
  buildRemoveCommand,
  buildSaveCommand,
  createCredentialStore,
  maskSecret,
  resolveBackendId,
  type CommandResult,
  type CommandRunner,
  type CredentialCommand,
} from '../src/auth/credentialStore.js';

const SECRET = 'acr_super_secret_refresh_token';
const ACCOUNT = 'https://api.agentteams.run';

type RunnerScript = (command: CredentialCommand) => CommandResult;

function recordingRunner(script: RunnerScript): { runner: CommandRunner; calls: CredentialCommand[] } {
  const calls: CredentialCommand[] = [];
  const runner: CommandRunner = (command) => {
    calls.push(command);
    return script(command);
  };
  return { runner, calls };
}

const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
const fail = (status: number | null, stderr = ''): CommandResult => ({ status, stdout: '', stderr });

describe('credentialStore backend selection', () => {
  it('maps each supported platform to its own backend', () => {
    expect(resolveBackendId('darwin')).toBe('macos-keychain');
    expect(resolveBackendId('win32')).toBe('windows-credential-manager');
    expect(resolveBackendId('linux')).toBe('libsecret');
    expect(resolveBackendId('aix')).toBe('none');
  });
});

describe('credentialStore command assembly', () => {
  it('keeps the macOS secret off argv and answers the retype prompt', () => {
    const command = buildSaveCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT, SECRET);

    expect(command).not.toBeNull();
    expect(command?.command).toBe('security');
    expect(command?.args).toEqual(['add-generic-password', '-a', ACCOUNT, '-s', CREDENTIAL_SERVICE, '-U', '-w']);
    expect(command?.args).not.toContain(SECRET);
    expect(command?.input).toBe(`${SECRET}\n${SECRET}\n`);
  });

  it('reads and removes macOS items by the same service/account pair', () => {
    expect(buildReadCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT)?.args).toEqual([
      'find-generic-password',
      '-a',
      ACCOUNT,
      '-s',
      CREDENTIAL_SERVICE,
      '-w',
    ]);
    expect(buildRemoveCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT)?.args).toEqual([
      'delete-generic-password',
      '-a',
      ACCOUNT,
      '-s',
      CREDENTIAL_SERVICE,
    ]);
  });

  it('pipes the libsecret secret through stdin', () => {
    const command = buildSaveCommand('libsecret', CREDENTIAL_SERVICE, ACCOUNT, SECRET);

    expect(command?.command).toBe('secret-tool');
    expect(command?.args).toEqual([
      'store',
      '--label',
      `${CREDENTIAL_SERVICE} (${ACCOUNT})`,
      'service',
      CREDENTIAL_SERVICE,
      'account',
      ACCOUNT,
    ]);
    expect(command?.args).not.toContain(SECRET);
    expect(command?.input).toBe(SECRET);
  });

  it('passes the Windows secret through the environment rather than the command line', () => {
    const command = buildSaveCommand('windows-credential-manager', CREDENTIAL_SERVICE, ACCOUNT, SECRET);

    expect(command?.command).toBe('powershell');
    expect(command?.args.join(' ')).not.toContain(SECRET);
    expect(command?.args).toContain('-NonInteractive');
    expect(command?.env).toMatchObject({
      AGENTTEAMS_CREDENTIAL_SERVICE: CREDENTIAL_SERVICE,
      AGENTTEAMS_CREDENTIAL_ACCOUNT: ACCOUNT,
      AGENTTEAMS_CREDENTIAL_SECRET: SECRET,
    });
  });

  it('builds nothing for a platform with no credential backend', () => {
    expect(buildSaveCommand('none', CREDENTIAL_SERVICE, ACCOUNT, SECRET)).toBeNull();
    expect(buildReadCommand('none', CREDENTIAL_SERVICE, ACCOUNT)).toBeNull();
    expect(buildRemoveCommand('none', CREDENTIAL_SERVICE, ACCOUNT)).toBeNull();
  });
});

describe('credentialStore without a usable backend', () => {
  it('refuses to persist and never writes a file when the probe fails', () => {
    const { runner, calls } = recordingRunner(() => fail(null, 'command not found'));
    const store = createCredentialStore({ runner, platform: 'linux' });

    const outcome = store.save(ACCOUNT, SECRET);

    expect(outcome).toEqual({ persisted: false, reason: 'NO_BACKEND' });
    expect(store.status()).toEqual({ backend: 'libsecret', persisted: false, reason: 'NO_BACKEND' });
    // Only the availability probe ran — no store command was attempted.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['--version']);
  });

  it('reports an unsupported platform without probing anything', () => {
    const { runner, calls } = recordingRunner(() => ok());
    const store = createCredentialStore({ runner, platform: 'aix' });

    expect(store.save(ACCOUNT, SECRET)).toEqual({ persisted: false, reason: 'UNSUPPORTED_PLATFORM' });
    expect(store.status().reason).toBe('UNSUPPORTED_PLATFORM');
    expect(calls).toHaveLength(0);
  });

  it('keeps the secret in session memory only, so it is readable in-process but not on disk', () => {
    const { runner } = recordingRunner(() => fail(null));
    const store = createCredentialStore({ runner, platform: 'linux' });
    const homeEntriesBefore = readdirSync(homedir()).length;

    store.save(ACCOUNT, SECRET);

    expect(store.read(ACCOUNT)).toBe(SECRET);
    expect(existsSync(join(homedir(), '.agentteams', 'credentials.json'))).toBe(false);
    expect(readdirSync(homedir()).length).toBe(homeEntriesBefore);
  });

  it('caches the probe result instead of shelling out on every call', () => {
    const { runner, calls } = recordingRunner(() => fail(null));
    const store = createCredentialStore({ runner, platform: 'darwin' });

    store.status();
    store.status();
    store.read(ACCOUNT);

    expect(calls).toHaveLength(1);
  });
});

describe('credentialStore with a working backend', () => {
  const workingRunner = (state: { stored?: string }): RunnerScript => {
    return (command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('add-generic-password')) {
        state.stored = command.input?.split('\n')[0];
        return ok();
      }
      if (command.args.includes('find-generic-password')) {
        return state.stored === undefined ? fail(44, 'could not be found') : ok(`${state.stored}\n`);
      }
      if (command.args.includes('delete-generic-password')) {
        if (state.stored === undefined) return fail(44);
        state.stored = undefined;
        return ok();
      }
      return fail(1);
    };
  };

  it('round-trips save → read → remove', () => {
    const state: { stored?: string } = {};
    const { runner } = recordingRunner(workingRunner(state));
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.save(ACCOUNT, SECRET)).toEqual({ persisted: true, reason: 'OK' });
    expect(state.stored).toBe(SECRET);

    // A fresh store proves the value came back from the backend, not the cache.
    const reader = createCredentialStore({ runner: recordingRunner(workingRunner(state)).runner, platform: 'darwin' });
    expect(reader.read(ACCOUNT)).toBe(SECRET);

    store.remove(ACCOUNT);
    expect(state.stored).toBeUndefined();
    const afterRemoval = createCredentialStore({
      runner: recordingRunner(workingRunner(state)).runner,
      platform: 'darwin',
    });
    expect(afterRemoval.read(ACCOUNT)).toBeNull();
  });

  it('returns null rather than throwing when the item is absent', () => {
    const { runner } = recordingRunner(workingRunner({}));
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.read(ACCOUNT)).toBeNull();
  });

  it('degrades a rejected write to a session-only credential instead of throwing', () => {
    // A probe-passing backend that refuses to write is the locked-keychain /
    // no-Secret-Service case; the caller must still get its secret back.
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      return fail(1, 'User interaction is not allowed.');
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.save(ACCOUNT, SECRET)).toMatchObject({ persisted: false, reason: 'WRITE_FAILED' });
    expect(store.read(ACCOUNT)).toBe(SECRET);
    // And the store stops claiming a durability it has already failed to provide.
    expect(store.status()).toMatchObject({ backend: 'macos-keychain', persisted: false, reason: 'WRITE_FAILED' });
  });

  it('never leaks the secret into a save failure detail', () => {
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      // A backend that echoes the value back is exactly the case masking exists for.
      return fail(1, `SecKeychainItemCreateFromContent failed for ${SECRET}`);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    const outcome = store.save(ACCOUNT, SECRET);

    expect(outcome.persisted).toBe(false);
    expect(outcome.detail).not.toContain(SECRET);
    expect(outcome.detail).toContain('***');
    expect(JSON.stringify(store.status())).not.toContain(SECRET);
  });

  it('masks every occurrence of a secret', () => {
    expect(maskSecret(`${SECRET} and ${SECRET}`, SECRET)).toBe('*** and ***');
    expect(maskSecret('nothing to mask', '')).toBe('nothing to mask');
  });
});

describe('credentialStore integration (macOS keychain)', () => {
  const macOnly = process.platform === 'darwin' ? it : it.skip;

  macOnly('stores, reads back, and deletes a real login-keychain item', () => {
    jest.setTimeout(20_000);
    const account = `agentteams-cli-test-${process.pid}`;
    const service = `agentteams-cli-test-${process.pid}`;
    const store = createCredentialStore({ platform: 'darwin', service });

    expect(store.status()).toEqual({ backend: 'macos-keychain', persisted: true, reason: 'OK' });

    try {
      expect(store.save(account, SECRET)).toEqual({ persisted: true, reason: 'OK' });

      // A second store instance has no memory cache, so this reads the keychain.
      const reader = createCredentialStore({ platform: 'darwin', service });
      expect(reader.read(account)).toBe(SECRET);
    } finally {
      store.remove(account);
    }

    const afterRemoval = createCredentialStore({ platform: 'darwin', service });
    expect(afterRemoval.read(account)).toBeNull();
  });
});

describe('credentialStore integration (Windows PasswordVault)', () => {
  const windowsOnly = process.platform === 'win32' ? it : it.skip;

  /**
   * PasswordVault is WinRT, which only projects into Windows PowerShell 5.1 —
   * `pwsh` 7 cannot load the type at all. `powershell` resolves to 5.1 on every
   * Windows install, and the probe turns a machine where it does not into an
   * unavailable backend rather than a false positive, so this is a real check
   * that the shipped command spelling still works on a real vault.
   */
  windowsOnly('stores, reads back, and deletes a real credential vault entry', () => {
    jest.setTimeout(30_000);
    const account = `personal-refresh:https://api-test-${process.pid}.example`;
    const service = `agentteams-cli-test-${process.pid}`;
    const store = createCredentialStore({ platform: 'win32', service });

    expect(store.status()).toEqual({ backend: 'windows-credential-manager', persisted: true, reason: 'OK' });

    try {
      expect(store.save(account, SECRET)).toEqual({ persisted: true, reason: 'OK' });

      // A second store instance has no memory cache, so this reads the vault.
      expect(createCredentialStore({ platform: 'win32', service }).read(account)).toBe(SECRET);

      // Refresh-token rotation saves over the same slot on every renewal, so
      // `Add` has to replace rather than duplicate or reject.
      expect(store.save(account, `${SECRET}_rotated`)).toEqual({ persisted: true, reason: 'OK' });
      expect(createCredentialStore({ platform: 'win32', service }).read(account)).toBe(`${SECRET}_rotated`);
    } finally {
      store.remove(account);
    }

    const afterRemoval = createCredentialStore({ platform: 'win32', service });
    expect(afterRemoval.read(account)).toBeNull();
  });
});
