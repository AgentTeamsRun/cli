import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
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

  it('detaches the macOS write from the terminal so the piped secret is what gets read', () => {
    // `security` collects the password with readpassphrase(3), which prefers
    // /dev/tty over stdin. With a terminal attached it prompts the user and
    // stores whatever the terminal supplied, ignoring the token on stdin.
    expect(buildSaveCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT, SECRET)?.detachTerminal).toBe(true);

    // Reads and deletes print to stdout and never prompt, so they keep the
    // parent's session.
    expect(buildReadCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT)?.detachTerminal).toBeUndefined();
    expect(buildRemoveCommand('macos-keychain', CREDENTIAL_SERVICE, ACCOUNT)?.detachTerminal).toBeUndefined();
    // Windows takes the secret through the environment, so nothing reads a tty —
    // and detaching there would mean a new console window.
    expect(
      buildSaveCommand('windows-credential-manager', CREDENTIAL_SERVICE, ACCOUNT, SECRET)?.detachTerminal,
    ).toBeUndefined();
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

  it('serves repeat reads from the cache but goes back to the backend when asked for a fresh one', () => {
    const state: { stored?: string } = { stored: SECRET };
    const { runner, calls } = recordingRunner(workingRunner(state));
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.read(ACCOUNT)).toBe(SECRET);
    expect(store.read(ACCOUNT)).toBe(SECRET);
    const cachedReads = calls.filter((call) => call.args.includes('find-generic-password')).length;

    // Another process rotates the credential in the backend.
    state.stored = `${SECRET}_rotated`;

    // The cache would hand back the superseded value, which the server treats as
    // reuse and answers by revoking the whole token family.
    expect(store.read(ACCOUNT)).toBe(SECRET);
    expect(store.read(ACCOUNT, { fresh: true })).toBe(`${SECRET}_rotated`);
    expect(calls.filter((call) => call.args.includes('find-generic-password')).length).toBe(cachedReads + 1);
    // And the refreshed value becomes the new cached one.
    expect(store.read(ACCOUNT)).toBe(`${SECRET}_rotated`);
  });

  it('drops the cached credential when a fresh read finds the backend empty', () => {
    const state: { stored?: string } = { stored: SECRET };
    const { runner } = recordingRunner(workingRunner(state));
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.read(ACCOUNT)).toBe(SECRET);

    // Another process logged out, so the credential is gone for good.
    state.stored = undefined;

    expect(store.read(ACCOUNT, { fresh: true })).toBeNull();
    // The cache must not resurrect it for the rest of this process's life.
    expect(store.read(ACCOUNT)).toBeNull();
  });

  it('keeps serving a session-only credential even when a fresh read is requested', () => {
    // A probe-passing backend that refuses writes leaves memory holding the only
    // copy; consulting the backend would find nothing and throw the live one away.
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('find-generic-password')) return fail(44, 'could not be found');
      return fail(1, 'User interaction is not allowed.');
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.save(ACCOUNT, SECRET)).toMatchObject({ persisted: false, reason: 'WRITE_FAILED' });
    expect(store.read(ACCOUNT, { fresh: true })).toBe(SECRET);
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

  it('refuses to call a write persisted when the backend kept a different value', () => {
    // Exactly the interactive-`security` failure: the tool prompts the terminal,
    // stores what it was given there, and still exits 0. Reporting that as a
    // successful login commits the project to a credential the server will
    // reject as expired, and every re-login repeats it.
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('add-generic-password')) return ok();
      if (command.args.includes('find-generic-password')) return ok('73117424\n');
      return fail(1);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    const outcome = store.save(ACCOUNT, SECRET);

    expect(outcome).toMatchObject({ persisted: false, reason: 'WRITE_FAILED' });
    expect(outcome.detail).not.toContain(SECRET);
    // The store stops claiming durability, and the caller still gets its secret
    // for this process — the documented session-only fallback.
    expect(store.status()).toMatchObject({ persisted: false, reason: 'WRITE_FAILED' });
    expect(store.read(ACCOUNT)).toBe(SECRET);
  });

  it('reports a write that silently stored nothing at all', () => {
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('add-generic-password')) return ok();
      // The item is simply absent afterwards.
      if (command.args.includes('find-generic-password')) return fail(44, 'could not be found');
      return fail(1);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.save(ACCOUNT, SECRET)).toMatchObject({ persisted: false, reason: 'WRITE_FAILED' });
  });

  it('keeps the credential when a fresh read fails for a reason other than absence', () => {
    // A locked keychain / denied access prompt exits non-zero without meaning the
    // item is gone. Treating that as removal drops a live credential and makes
    // logout claim there is nothing to revoke.
    const state: { stored?: string } = { stored: SECRET };
    let denyReads = false;
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('find-generic-password')) {
        if (denyReads) return fail(51, 'User interaction is not allowed.');
        return state.stored === undefined ? fail(44, 'could not be found') : ok(`${state.stored}\n`);
      }
      return fail(1);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.read(ACCOUNT)).toBe(SECRET);
    denyReads = true;

    // Fails closed: the caller is about to present the value somewhere staleness
    // is punished, so it gets nothing rather than an unverified guess.
    expect(store.read(ACCOUNT, { fresh: true })).toBeNull();
    // But the cached copy survives, so a later plain read still works.
    expect(store.read(ACCOUNT)).toBe(SECRET);
  });

  it('does not report a write as failed when only its verification read was denied', () => {
    // The read-back exists to catch a silently corrupted write. A read that
    // cannot run is not evidence of that, and treating it as one would revoke a
    // token that did store.
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      if (command.args.includes('add-generic-password')) return ok();
      if (command.args.includes('find-generic-password')) return fail(51, 'User interaction is not allowed.');
      return fail(1);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    const outcome = store.save(ACCOUNT, SECRET);

    // Still not claimed as persisted — we genuinely do not know — but the reason
    // says verification, not that the store rejected the value.
    expect(outcome.persisted).toBe(false);
    expect(outcome.detail).toContain('could not be verified');
  });

  it('keeps a failed write from disabling fresh reads for other accounts', () => {
    // A store-wide latch made one account's failed write silently turn every
    // later fresh read into a cache hit, disabling the cross-process guard.
    const items = new Map<string, string>([['other-account', 'other-value']]);
    const { runner } = recordingRunner((command) => {
      if (command.args.includes('list-keychains')) return ok();
      const account = command.args[command.args.indexOf('-a') + 1] ?? '';
      if (command.args.includes('add-generic-password')) return fail(1, 'User interaction is not allowed.');
      if (command.args.includes('find-generic-password')) {
        const stored = items.get(account);
        return stored === undefined ? fail(44) : ok(`${stored}\n`);
      }
      return fail(1);
    });
    const store = createCredentialStore({ runner, platform: 'darwin' });

    expect(store.save(ACCOUNT, SECRET).persisted).toBe(false);
    // The failed account keeps serving memory: it is the only copy there is.
    expect(store.read(ACCOUNT, { fresh: true })).toBe(SECRET);

    // A different account still re-reads the backend.
    expect(store.read('other-account', { fresh: true })).toBe('other-value');
    items.set('other-account', 'other-value-rotated');
    expect(store.read('other-account', { fresh: true })).toBe('other-value-rotated');
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

  /**
   * The regression this exists for could not be reproduced by any of the tests
   * above, including the real-keychain one below: Jest runs with no controlling
   * terminal, which is the only condition under which `security` reads the
   * piped secret. In an interactive shell it prompted the user instead and
   * stored whatever the terminal supplied — a silent corruption that surfaced
   * later as "your login was revoked or expired".
   *
   * So the terminal has to be real. `script` allocates a pty, and the child
   * spawns the shipped command the way `defaultRunner` does; drop
   * `detachTerminal` and this test hangs until its timeout rather than passing.
   */
  macOnly(
    'writes the piped secret even when a controlling terminal is present',
    () => {
      const account = `agentteams-cli-pty-${process.pid}`;
      const service = `agentteams-cli-pty-${process.pid}`;
      const secret = `atr_${'p'.repeat(43)}`;
      const workspace = mkdtempSync(join(tmpdir(), 'agentteams-pty-'));
      const child = join(workspace, 'save.mjs');
      writeFileSync(
        child,
        [
          "import { spawnSync } from 'node:child_process';",
          'const command = JSON.parse(process.argv[2]);',
          'const result = spawnSync(command.command, command.args, {',
          "  encoding: 'utf-8',",
          '  input: command.input,',
          '  windowsHide: true,',
          '  ...(command.detachTerminal ? { detached: true } : {}),',
          '});',
          'process.stdout.write(`STATUS=${result.status}\\n`);',
        ].join('\n'),
        'utf-8',
      );

      const command = buildSaveCommand('macos-keychain', service, account, secret);

      try {
        const output = execFileSync('script', ['-q', '/dev/null', process.execPath, child, JSON.stringify(command)], {
          encoding: 'utf-8',
          // A non-detached child blocks on the prompt forever; fail rather than hang.
          timeout: 30_000,
          // `script` copies terminal settings from its own stdin, which under
          // Jest is a socket it cannot `tcgetattr`.
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        expect(output).toContain('STATUS=0');
        expect(createCredentialStore({ platform: 'darwin', service }).read(account)).toBe(secret);
      } finally {
        createCredentialStore({ platform: 'darwin', service }).remove(account);
        rmSync(workspace, { recursive: true, force: true });
      }
    },
    // Longer than the inner `script` timeout, so a hang is reported as the
    // prompt it is rather than as a bare Jest timeout.
    40_000,
  );

  macOnly(
    'stores, reads back, and deletes a real login-keychain item',
    () => {
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
      // Each `security` call is a process spawn, and the save now verifies itself
      // with a read, so give a loaded machine room.
    },
    20_000,
  );
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
  windowsOnly(
    'stores, reads back, and deletes a real credential vault entry',
    () => {
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
      // Every vault call spawns a WinRT PowerShell — around a second each, and the
      // self-verifying save adds one per write.
    },
    60_000,
  );
});
