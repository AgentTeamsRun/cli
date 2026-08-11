/**
 * Contract for the platform-neutral credential file fallback.
 *
 * This backend only ever runs when the OS credential store cannot keep the
 * personal refresh token — an SSH session with no Secret Service, a locked login
 * keychain, a PasswordVault that refuses the write. It is therefore the last
 * thing standing between a remote user and "signed in, but the login could not be
 * saved", and every assertion here is about the two ways it could betray that
 * role: writing a token somewhere another account can read it, or reading a token
 * out of a path someone else controls.
 *
 * Nothing in this file touches the real home directory: every store is pointed at
 * a temp directory, exactly as the shipped one is pointed at `~/.agentteams`.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, CommandRunner, CredentialCommand } from '../src/auth/credentialStore.js';
import {
  FILE_CREDENTIAL_BACKEND,
  checkPosixProtection,
  createFileCredentialStore,
  credentialFileName,
  verifyAclOutput,
} from '../src/auth/fileCredentialStore.js';
import { refreshLockFileName } from '../src/auth/refreshLock.js';

const SECRET = 'atr_super_secret_refresh_token';
const SLOT = 'personal-refresh:https://api.agentteams.run';
const OTHER_SLOT = 'personal-refresh:https://dev-api.agentteams.run';
const posixIt = process.platform === 'win32' ? it.skip : it;

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'agentteams-filecred-'));
  homes.push(home);
  return home;
}

function credentialDir(home: string): string {
  return join(home, '.agentteams', 'credentials');
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

/** A runner that must never be reached on POSIX — ACL hardening is win32-only. */
const unusedRunner: CommandRunner = () => {
  throw new Error('the POSIX path must not shell out');
};

describe('credential file naming', () => {
  it('derives the filename from the same slot hash as the rotation lock', () => {
    const name = credentialFileName(SLOT);

    expect(name).toMatch(/^personal-token-[0-9a-f]{16}\.cred$/);
    // Same hash, different suffix: one slot's lock and its credential file must be
    // recognisably a pair without ever colliding.
    expect(name.replace(/\.cred$/, '.lock')).toBe(refreshLockFileName(SLOT));
    expect(credentialFileName(OTHER_SLOT)).not.toBe(name);
  });

  it('never reuses the slot text itself, which carries an unencodable URL', () => {
    expect(credentialFileName(SLOT)).not.toContain('https');
    expect(credentialFileName(SLOT)).not.toContain('/');
  });
});

describe('file credential store on POSIX', () => {
  posixIt('round-trips a token between two independent store instances', () => {
    const home = createHome();
    const writer = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    expect(writer.isUsable()).toBe(true);
    expect(writer.save(SLOT, SECRET)).toEqual({ ok: true });

    // A second instance stands in for the next CLI process: no shared memory, so
    // the value can only have come off disk.
    const reader = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    expect(reader.has(SLOT)).toBe(true);
    expect(reader.read(SLOT)).toEqual({ kind: 'found', secret: SECRET });
  });

  posixIt('creates the directory 0700 and the credential file 0600', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    store.save(SLOT, SECRET);

    expect(statSync(credentialDir(home)).mode & 0o777).toBe(0o700);
    expect(statSync(join(credentialDir(home), credentialFileName(SLOT))).mode & 0o777).toBe(0o600);
  });

  posixIt('keeps one file per slot so deleting one login leaves the other alone', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    store.save(SLOT, SECRET);
    store.save(OTHER_SLOT, `${SECRET}_other`);
    expect(readdirSync(credentialDir(home))).toHaveLength(2);

    store.remove(SLOT);

    expect(store.read(SLOT)).toEqual({ kind: 'missing' });
    expect(store.read(OTHER_SLOT)).toEqual({ kind: 'found', secret: `${SECRET}_other` });
  });

  posixIt('replaces the file on rotation rather than appending a second copy', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    store.save(SLOT, SECRET);
    store.save(SLOT, `${SECRET}_rotated`);

    expect(readdirSync(credentialDir(home))).toEqual([credentialFileName(SLOT)]);
    expect(store.read(SLOT)).toEqual({ kind: 'found', secret: `${SECRET}_rotated` });
    // No staging file may survive a completed write.
    expect(readdirSync(credentialDir(home)).filter((entry) => entry.includes('tmp'))).toHaveLength(0);
  });

  it('treats a removal of something already gone as success', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    expect(() => store.remove(SLOT)).not.toThrow();
    expect(store.has(SLOT)).toBe(false);
    expect(store.read(SLOT)).toEqual({ kind: 'missing' });
  });

  it('refuses a credential directory that group or other can reach', () => {
    const home = createHome();
    mkdirSync(credentialDir(home), { recursive: true, mode: 0o755 });
    // Recreate the mode explicitly: `mkdir`'s mode is masked by umask.
    const store = createFileCredentialStore({
      homeDir: home,
      platform: 'linux',
      runner: unusedRunner,
      // The shipped store restates 0700 on a directory it owns; a directory it
      // cannot bring down to 0700 is the one that must be refused.
      hardenDirectory: false,
    });

    expect(store.isUsable()).toBe(false);
    expect(store.save(SLOT, SECRET).ok).toBe(false);
    expect(readdirSync(credentialDir(home))).toHaveLength(0);
  });

  posixIt('restates 0700 on a directory it owns instead of failing the login', () => {
    const home = createHome();
    mkdirSync(credentialDir(home), { recursive: true, mode: 0o755 });
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    expect(store.isUsable()).toBe(true);
    expect(statSync(credentialDir(home)).mode & 0o777).toBe(0o700);
  });

  it('fails closed on a symlink standing in for the credential file', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.isUsable();

    const target = join(home, 'attacker-target');
    writeFileSync(target, 'original', 'utf-8');
    symlinkSync(target, join(credentialDir(home), credentialFileName(SLOT)));

    const read = store.read(SLOT);
    expect(read.kind).toBe('error');
    const save = store.save(SLOT, SECRET);
    expect(save.ok).toBe(false);

    // The link was neither followed nor replaced behind the user's back.
    expect(readFileSync(target, 'utf-8')).toBe('original');
    expect(lstatSync(join(credentialDir(home), credentialFileName(SLOT))).isSymbolicLink()).toBe(true);
  });

  it('fails closed on a directory standing in for the credential file', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.isUsable();
    mkdirSync(join(credentialDir(home), credentialFileName(SLOT)), { recursive: true });

    expect(store.read(SLOT).kind).toBe('error');
    expect(store.save(SLOT, SECRET).ok).toBe(false);
    expect(statSync(join(credentialDir(home), credentialFileName(SLOT))).isDirectory()).toBe(true);
  });

  posixIt('fails closed on a world-readable credential file rather than quietly fixing it', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.isUsable();
    const path = join(credentialDir(home), credentialFileName(SLOT));
    writeFileSync(path, JSON.stringify({ version: 1, secret: 'planted' }), { encoding: 'utf-8', mode: 0o644 });

    const read = store.read(SLOT);
    expect(read.kind).toBe('error');
    expect(store.save(SLOT, SECRET).ok).toBe(false);
    // Silently chmod-ing someone else's file would hide the tampering it signals.
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });

  it('never puts the token in an error detail or in the filename', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.isUsable();
    mkdirSync(join(credentialDir(home), credentialFileName(SLOT)), { recursive: true });

    const save = store.save(SLOT, SECRET);
    expect(save.ok).toBe(false);
    expect(save.ok === false ? save.detail : '').not.toContain(SECRET);

    const read = store.read(SLOT);
    expect(read.kind === 'error' ? read.detail : '').not.toContain(SECRET);
  });

  it('reports corrupt content as an error without echoing what it read', () => {
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.isUsable();
    writeFileSync(join(credentialDir(home), credentialFileName(SLOT)), 'not json at all', {
      encoding: 'utf-8',
      mode: 0o600,
    });

    const read = store.read(SLOT);
    expect(read.kind).toBe('error');
    expect(read.kind === 'error' ? read.detail : '').not.toContain('not json at all');
  });

  posixIt('answers a read-only usability question without creating anything', () => {
    // `auth status` asks this. A status command that leaves a credential
    // directory behind on a machine that has never logged in is a trace nobody
    // asked for, and it makes the directory's presence meaningless as evidence.
    const home = createHome();
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    expect(store.check({ create: false })).toEqual({ ok: true });
    expect(existsSync(credentialDir(home))).toBe(false);

    // The creating call is still the one that decides, and it does create.
    expect(store.isUsable()).toBe(true);
    expect(existsSync(credentialDir(home))).toBe(true);
  });

  it('does not call a repairable directory unusable in the read-only check', () => {
    // `save()` restates 0700 before it writes, so loose bits are not a reason to
    // tell the user the fallback is unavailable — and the check may not fix them
    // itself, because it must not touch anything.
    const home = createHome();
    mkdirSync(credentialDir(home), { recursive: true, mode: 0o755 });
    const modeBefore = statSync(credentialDir(home)).mode & 0o777;
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    expect(store.check({ create: false })).toEqual({ ok: true });
    expect(statSync(credentialDir(home)).mode & 0o777).toBe(modeBefore);
  });

  it('says why a directory it cannot use is unusable, rather than only that it is', () => {
    // The reason lives nowhere else: swallowed here, the user is told the login
    // could not be saved and is left to guess at a path they cannot see.
    const home = createHome();
    mkdirSync(join(home, '.agentteams'), { recursive: true });
    writeFileSync(join(home, '.agentteams', 'credentials'), 'not a directory', 'utf-8');
    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });

    const readOnly = store.check({ create: false });
    expect(readOnly.ok).toBe(false);
    expect(readOnly.ok === false ? readOnly.detail : '').toMatch(/not a directory/i);

    const save = store.save(SLOT, SECRET);
    expect(save.ok).toBe(false);
    expect(save.ok === false ? save.detail : '').toMatch(/not a directory/i);
  });

  it('leaves the real home directory untouched', () => {
    const home = createHome();
    const before = readdirSync(homedir()).length;

    const store = createFileCredentialStore({ homeDir: home, platform: 'linux', runner: unusedRunner });
    store.save(SLOT, SECRET);

    expect(readdirSync(homedir()).length).toBe(before);
  });
});

describe('POSIX protection predicate', () => {
  const owner = { kind: 'file' as const, uid: 501 };

  it('accepts a regular file owned by this user with no group or other bits', () => {
    expect(
      checkPosixProtection({ isSymbolicLink: false, isDirectory: false, isFile: true, mode: 0o600, uid: 501 }, owner),
    ).toEqual({ ok: true });
  });

  it('rejects a file owned by a different user', () => {
    const result = checkPosixProtection(
      { isSymbolicLink: false, isDirectory: false, isFile: true, mode: 0o600, uid: 0 },
      owner,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.detail : '').toMatch(/owned/i);
  });

  it('rejects group or other access even when the owner is right', () => {
    expect(
      checkPosixProtection({ isSymbolicLink: false, isDirectory: false, isFile: true, mode: 0o640, uid: 501 }, owner)
        .ok,
    ).toBe(false);
    expect(
      checkPosixProtection({ isSymbolicLink: false, isDirectory: false, isFile: true, mode: 0o604, uid: 501 }, owner)
        .ok,
    ).toBe(false);
  });

  it('rejects a symlink and a wrong node type before anything is read', () => {
    expect(
      checkPosixProtection({ isSymbolicLink: true, isDirectory: false, isFile: false, mode: 0o600, uid: 501 }, owner)
        .ok,
    ).toBe(false);
    expect(
      checkPosixProtection({ isSymbolicLink: false, isDirectory: true, isFile: false, mode: 0o700, uid: 501 }, owner)
        .ok,
    ).toBe(false);
    expect(
      checkPosixProtection(
        { isSymbolicLink: false, isDirectory: false, isFile: true, mode: 0o600, uid: 501 },
        {
          kind: 'directory',
          uid: 501,
        },
      ).ok,
    ).toBe(false);
  });
});

describe('Windows ACL verification', () => {
  const principal = 'DESKTOP-1\\dev';
  const path = 'C:\\x.cred';

  it('accepts a single explicit ACE for the current user', () => {
    const inspected = 'C:\\Users\\dev\\.agentteams\\credentials\\x.cred';
    const output = [`${inspected} DESKTOP-1\\dev:(F)`, '', ''].join('\r\n');

    expect(verifyAclOutput(output, principal, inspected)).toEqual({ ok: true });
  });

  it('rejects any inherited entry, which is what /inheritance:r exists to remove', () => {
    const output = 'C:\\x.cred DESKTOP-1\\dev:(I)(F)\r\n';

    const result = verifyAclOutput(output, principal, path);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.detail : '').toMatch(/inherit/i);
  });

  it('rejects an ACL that also grants another principal', () => {
    const output = [
      'C:\\x.cred DESKTOP-1\\dev:(F)',
      '          NT AUTHORITY\\SYSTEM:(F)',
      '          BUILTIN\\Administrators:(F)',
    ].join('\r\n');

    expect(verifyAclOutput(output, principal, path).ok).toBe(false);
  });

  it('rejects an ACL it cannot read at all rather than assuming the best', () => {
    expect(verifyAclOutput('', principal, path).ok).toBe(false);
    expect(verifyAclOutput('Successfully processed 0 files; Failed processing 1 files', principal, path).ok).toBe(
      false,
    );
  });

  it('matches the principal case-insensitively, the way Windows does', () => {
    expect(verifyAclOutput('C:\\x.cred desktop-1\\DEV:(F)', principal, path)).toEqual({ ok: true });
  });

  it('accepts an account name containing spaces, which Windows allows', () => {
    // `DOMAIN\John Smith` is an ordinary Windows account. Reading the principal
    // as the last whitespace-free run cut it down to `Smith`, so the CLI rejected
    // the very ACL it had just applied and the fallback went dark on that machine.
    const spaced = 'DESK\\John Smith';
    const file = 'C:\\Users\\John Smith\\.agentteams\\credentials\\x.cred';

    expect(verifyAclOutput(`${file} ${spaced}:(F)\r\n`, spaced, file)).toEqual({ ok: true });
    // A directory grant carries propagation flags and must pass the same way.
    const directory = 'C:\\Users\\John Smith\\.agentteams\\credentials';
    expect(verifyAclOutput(`${directory} ${spaced}:(OI)(CI)(F)\r\n`, spaced, directory)).toEqual({ ok: true });
  });

  it('still rejects a different account even when the path contains spaces', () => {
    const file = 'C:\\Users\\John Smith\\x.cred';

    expect(verifyAclOutput(`${file} DESK\\John Smith:(F)\r\n`, 'DESK\\dev', file).ok).toBe(false);
    expect(verifyAclOutput(`${file} OTHERDESK\\dev:(F)\r\n`, 'DESK\\dev', file).ok).toBe(false);
    // The path echo is stripped exactly, so a name that merely ends the same way
    // is not mistaken for the account this CLI granted.
    expect(verifyAclOutput(`${file} DESK\\John Smith:(F)\r\n`, 'Smith', file).ok).toBe(false);
  });
});

describe('file credential store on Windows', () => {
  const env = { USERDOMAIN: 'DESKTOP-1', USERNAME: 'dev' };
  const principal = 'DESKTOP-1\\dev';

  function icaclsRunner(options: { hardenStatus?: number | null; aclOutput?: (path: string) => string } = {}): {
    runner: CommandRunner;
    calls: CredentialCommand[];
  } {
    const calls: CredentialCommand[] = [];
    const runner: CommandRunner = (command) => {
      calls.push(command);
      const path = command.args[0] ?? '';
      const harden = command.args.some((arg) => arg.startsWith('/grant'));
      if (harden) {
        // `?? 0` would swallow the deliberate `null`, which is how a runner
        // reports "the executable could not be spawned at all".
        const status = 'hardenStatus' in options ? (options.hardenStatus as number | null) : 0;
        return { status, stdout: '', stderr: status === 0 ? '' : 'access denied' } as CommandResult;
      }
      const output = options.aclOutput ? options.aclOutput(path) : `${path} ${principal}:(F)\r\n`;
      return { status: 0, stdout: output, stderr: '' };
    };
    return { runner, calls };
  }

  it('strips inheritance and grants the current user alone, with no token on argv', () => {
    const home = createHome();
    const { runner, calls } = icaclsRunner();
    const store = createFileCredentialStore({ homeDir: home, platform: 'win32', runner, env });

    expect(store.save(SLOT, SECRET)).toEqual({ ok: true });

    const hardened = calls.filter((call) => call.args.some((arg) => arg.startsWith('/grant')));
    expect(hardened.length).toBeGreaterThanOrEqual(2); // directory and file
    for (const call of hardened) {
      expect(call.command).toBe('icacls');
      expect(call.args).toContain('/inheritance:r');
      expect(call.args.some((arg) => arg.includes(principal))).toBe(true);
      expect(call.args.join(' ')).not.toContain(SECRET);
    }
    expect(store.read(SLOT)).toEqual({ kind: 'found', secret: SECRET });
  });

  it('fails closed when the ACL still lists another principal after hardening', () => {
    const home = createHome();
    const { runner } = icaclsRunner({
      aclOutput: (path) => `${path} ${principal}:(F)\r\n        BUILTIN\\Users:(F)\r\n`,
    });
    const store = createFileCredentialStore({ homeDir: home, platform: 'win32', runner, env });

    expect(store.save(SLOT, SECRET).ok).toBe(false);
    expect(store.read(SLOT).kind).not.toBe('found');
    // A token must never be left behind under an ACL that failed verification.
    expect(readdirSync(credentialDir(home))).toHaveLength(0);
  });

  it('declines the whole backend when icacls cannot be run', () => {
    const home = createHome();
    const { runner } = icaclsRunner({ hardenStatus: null });
    const store = createFileCredentialStore({ homeDir: home, platform: 'win32', runner, env });

    // No ACL means no protection, and an unprotected token file is worse than
    // refusing to store one — the caller falls back to the existing refusal.
    expect(store.isUsable()).toBe(false);
    expect(store.save(SLOT, SECRET).ok).toBe(false);
  });

  it('declines when Windows does not tell us who the current user is', () => {
    const home = createHome();
    const { runner } = icaclsRunner();
    const store = createFileCredentialStore({ homeDir: home, platform: 'win32', runner, env: {} });

    expect(store.isUsable()).toBe(false);
  });

  it('stores and reads back for an account whose name contains spaces', () => {
    // End to end for the account shape that used to disable the backend: the ACL
    // is granted to `DESK\John Smith` and then has to be recognised as ours.
    const home = createHome();
    const spacedEnv = { USERDOMAIN: 'DESK', USERNAME: 'John Smith' };
    const spaced = 'DESK\\John Smith';
    const { runner } = icaclsRunner({ aclOutput: (path) => `${path} ${spaced}:(F)\r\n` });
    const store = createFileCredentialStore({ homeDir: home, platform: 'win32', runner, env: spacedEnv });

    expect(store.save(SLOT, SECRET)).toEqual({ ok: true });
    expect(store.read(SLOT)).toEqual({ kind: 'found', secret: SECRET });
  });

  it('names the backend so status output can say where the token really is', () => {
    expect(FILE_CREDENTIAL_BACKEND).toBe('protected-file');
  });
});
