import { describe, expect, it } from '@jest/globals';
import { formatAuthResultText } from '../src/utils/authFormat.js';

const STATUS = {
  apiUrl: 'https://api.agentteams.run',
  configPath: '/repo/.agentteams/config.json',
  credentialSource: 'personal-token',
  authMode: 'personal-token',
  hasProjectApiKey: false,
  personalToken: {
    connected: true,
    persisted: true,
    storeBackend: 'macos-keychain',
    storeReason: 'OK',
    reconnectRequired: false,
    identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'Dev' },
    expiresAt: '2026-07-30T00:56:54.132Z',
  },
};

describe('auth status as text', () => {
  it('leads with the credential that will actually be used', () => {
    const lines = formatAuthResultText('status', STATUS).split('\n');

    // The question a person runs `auth status` to answer.
    expect(lines[0]).toBe('Credential: personal login');
    expect(lines).toContain('Signed in as Dev <dev@example.com>');
    expect(lines).toContain('Server: https://api.agentteams.run');
    expect(lines).toContain('Project: /repo/.agentteams/config.json (personal login)');
    expect(lines).toContain('Store: macOS keychain (OK)');
    expect(lines).toContain('Access token expires: 2026-07-30T00:56:54.132Z');
  });

  it('never prints a raw JSON payload or a null field', () => {
    const text = formatAuthResultText('status', {
      ...STATUS,
      credentialSource: null,
      personalToken: { ...STATUS.personalToken, identity: null, expiresAt: null },
    });

    expect(text).not.toContain('null');
    expect(text).not.toContain('{');
    expect(text).toContain('Credential: none usable');
    expect(text).not.toContain('Signed in as');
    expect(text).not.toContain('Access token expires');
  });

  it('puts the problem last, where the eye lands', () => {
    const text = formatAuthResultText('status', {
      ...STATUS,
      credentialSource: null,
      problem:
        "This project is configured to use a personal login, but no credential is stored. Run 'agentteams auth login'.",
    });

    expect(text.split('\n').at(-1)).toBe(
      "Problem: This project is configured to use a personal login, but no credential is stored. Run 'agentteams auth login'.",
    );
  });

  it('spells out a stored-but-rejected login, which "connected" alone hides', () => {
    const text = formatAuthResultText('status', {
      ...STATUS,
      credentialSource: null,
      personalToken: { ...STATUS.personalToken, reconnectRequired: true, identity: null, expiresAt: null },
    });

    expect(text).toContain("Sign-in required: the stored login was rejected. Run 'agentteams auth login'.");
  });

  it('says a session-only store will not survive the process', () => {
    const text = formatAuthResultText('status', {
      ...STATUS,
      personalToken: { ...STATUS.personalToken, persisted: false, storeReason: 'WRITE_FAILED' },
    });

    expect(text).toContain('Store: macOS keychain (session only — nothing is written to disk)');
  });

  it('names the file fallback and says plainly that it is weaker than the keyring', () => {
    // Someone reading this line is deciding whether this machine should hold a
    // login at all, and "protected file" alone does not answer that.
    const text = formatAuthResultText('status', {
      ...STATUS,
      personalToken: {
        ...STATUS.personalToken,
        storeBackend: 'protected-file',
        storeReason: 'OK',
        storeDetail: 'secret-tool could not be started on this machine',
      },
    });

    expect(text).toContain('Store: protected file (~/.agentteams/credentials)');
    // The OS-side reason, not the useless `OK` the fallback always reports.
    expect(text).toContain('secret-tool could not be started on this machine');
    expect(text).toContain('weaker than the OS keyring');
    expect(text).not.toContain('macOS keychain');
  });
});

describe('auth login as text', () => {
  it('reports who signed in, where it went, and what changed', () => {
    const text = formatAuthResultText('login', {
      success: true,
      authUrl: 'https://agentteams.run/cli/authorize?port=1',
      apiUrl: 'https://api.agentteams.run',
      identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'Dev' },
      persisted: true,
      storeBackend: 'macos-keychain',
      storeReason: 'OK',
      configPath: '/repo/.agentteams/config.json',
      authMode: 'personal-token',
    });

    expect(text.split('\n')).toEqual([
      'Signed in as Dev <dev@example.com>',
      'Server: https://api.agentteams.run',
      'Stored in: macOS keychain (OK)',
      'Project: /repo/.agentteams/config.json (switched to personal login)',
    ]);
    // The authorize URL was already printed during the browser round trip.
    expect(text).not.toContain('authorize?');
  });

  it('does not claim a project switch that did not happen, and surfaces the warning', () => {
    const text = formatAuthResultText('login', {
      success: true,
      apiUrl: 'https://api.agentteams.run',
      identity: { email: 'dev@example.com', nickname: 'Dev' },
      persisted: true,
      storeBackend: 'macos-keychain',
      storeReason: 'OK',
      configPath: null,
      authMode: 'personal-token',
      warning: 'No project config was found, so nothing was switched to the personal login.',
    });

    expect(text).not.toContain('switched to personal login');
    expect(text).toContain('Warning: No project config was found');
  });

  it('does not let a file-backed login pass for a keyring one', () => {
    const text = formatAuthResultText('login', {
      success: true,
      apiUrl: 'https://api.agentteams.run',
      identity: { email: 'dev@example.com', nickname: 'Dev' },
      persisted: true,
      storeBackend: 'protected-file',
      storeReason: 'OK',
      storeDetail: 'the credential store rejected the write',
      configPath: '/repo/.agentteams/config.json',
      authMode: 'personal-token',
      deviceAuth: true,
    });

    expect(text).toContain('Stored in: protected file (~/.agentteams/credentials)');
    expect(text).toContain('weaker than the OS keyring');
    expect(text).not.toContain('credential store (OK)');
  });
});

describe('auth logout as text', () => {
  it('is explicit about whether the server-side token is gone', () => {
    const revoked = formatAuthResultText('logout', {
      success: true,
      apiUrl: 'https://api.agentteams.run',
      configPath: '/repo/.agentteams/config.json',
      revokedOnServer: true,
      fellBackToApiKey: false,
    });
    expect(revoked).toContain('Server-side token: revoked');

    // `--local` leaves a live token the user has to go and cancel.
    const localOnly = formatAuthResultText('logout', {
      success: true,
      apiUrl: 'https://api.agentteams.run',
      configPath: null,
      revokedOnServer: false,
      fellBackToApiKey: true,
    });
    expect(localOnly).toContain('Server-side token: still valid — revoke it in the AgentTeams web app');
    expect(localOnly).toContain('This project fell back to the API key still in its config.');
  });
});

describe('auth text fallback', () => {
  it('falls back to JSON for an action it does not know', () => {
    // A new subcommand must not be silently reduced to nothing.
    expect(formatAuthResultText('rotate', { some: 'payload' })).toBe(JSON.stringify({ some: 'payload' }, null, 2));
  });
});
