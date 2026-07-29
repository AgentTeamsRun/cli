import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCredentialStore,
  type CommandResult,
  type CredentialCommand,
  type CredentialStore,
} from '../src/auth/credentialStore.js';
import { PersonalTokenClient } from '../src/auth/personalTokenClient.js';
import { createPersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { createAuthState, createPkcePair, startAuthorizationCodeServer } from '../src/utils/authServer.js';
import { findProjectConfig, loadConfigWithCredential, setProjectAuthMode } from '../src/utils/config.js';

/**
 * The whole opt-in path in one place: browser callback → PKCE exchange → OS
 * credential store → credential resolution → revoke.
 *
 * Only the human clicking "Authorize" is stood in for; the loopback server, the
 * state check, the PKCE verification, the token endpoints and — wherever the
 * machine has one — the real OS credential store are all exercised as they ship.
 */

const WEB_ORIGIN = 'https://agentteams.run';

type TokenServer = {
  url: string;
  close: () => Promise<void>;
  /** Refresh tokens the server currently accepts. Rotation replaces the entry. */
  issued: Set<string>;
  revoked: string[];
};

function startTokenServer(expectedChallenge: string): Promise<TokenServer> {
  const issued = new Set<string>();
  const revoked: string[] = [];
  let counter = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as Record<string, string>;
      const send = (status: number, payload: unknown): void => {
        const text = JSON.stringify(payload);
        response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
        response.end(text);
      };

      if (request.url === '/api/auth/desktop/revoke') {
        if (!issued.has(body.token)) {
          send(400, { error: 'invalid_request' });
          return;
        }
        revoked.push(body.token);
        issued.delete(body.token);
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.url !== '/api/auth/desktop/token') {
        send(404, { error: 'not_found' });
        return;
      }

      if (body.grantType === 'authorization_code') {
        // Exactly what the server does: sha256(code_verifier) must equal the
        // challenge the browser handed over.
        const challenge = createHash('sha256')
          .update(body.codeVerifier ?? '')
          .digest('base64url');
        if (challenge !== expectedChallenge) {
          send(401, { error: 'invalid_grant' });
          return;
        }
      } else if (body.grantType === 'refresh_token') {
        if (!issued.has(body.refreshToken)) {
          send(401, { error: 'invalid_grant', reason: 'UNKNOWN' });
          return;
        }
        issued.delete(body.refreshToken);
      } else {
        send(400, { error: 'unsupported_grant_type' });
        return;
      }

      counter += 1;
      const refreshToken = `atr_refresh_${counter}`;
      issued.add(refreshToken);
      send(200, {
        data: {
          accessToken: `atp_access_${counter}`,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
          refreshExpiresIn: 2_592_000,
          identity: { memberId: 'm-1', email: 'dev@example.com', nickname: 'dev' },
        },
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
        issued,
        revoked,
      });
    });
  });
}

/**
 * A credential store that always persists.
 *
 * The real OS store is used when the machine has a working one, because that is
 * the configuration the CLI actually ships into. CI runners are headless — no
 * Secret Service on Linux — and there a login that cannot be stored is aborted
 * by design, which would leave this test asserting the failure path instead of
 * the round trip. So a stand-in backend takes over: the same `CredentialStore`
 * wrapper driven by a scripted `security` runner, keeping the store's own
 * caching and trailing-newline handling in the loop. Whether each platform's
 * commands are assembled correctly is `credentialStore.test.ts`'s job.
 *
 * Returns a factory rather than one store: every instance shares the backend but
 * has its own read cache, which is what lets the test prove a value came back
 * from storage instead of from memory.
 */
function createRoundTripStoreFactory(service: string): () => CredentialStore {
  if (createCredentialStore({ service }).status().persisted) {
    return () => createCredentialStore({ service });
  }

  const items = new Map<string, string>();
  const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
  // `security` answers a missing item with 44, not with an empty value.
  const absent = (): CommandResult => ({ status: 44, stdout: '', stderr: '' });

  const runner = (command: CredentialCommand): CommandResult => {
    const account = command.args[command.args.indexOf('-a') + 1] ?? '';
    if (command.args.includes('add-generic-password')) {
      items.set(account, command.input?.split('\n')[0] ?? '');
      return ok();
    }
    if (command.args.includes('find-generic-password')) {
      const stored = items.get(account);
      return stored === undefined ? absent() : ok(`${stored}\n`);
    }
    if (command.args.includes('delete-generic-password')) {
      return items.delete(account) ? ok() : absent();
    }
    // `list-keychains` — the availability probe.
    return ok();
  };

  return () => createCredentialStore({ service, platform: 'darwin', runner });
}

const tempDirs: string[] = [];
let originalCwd: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  process.env.AGENTTEAMS_WEB_URL = WEB_ORIGIN;
  delete process.env.AGENTTEAMS_API_KEY;
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function createProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-roundtrip-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  process.chdir(root);
  return join(root, '.agentteams', 'config.json');
}

describe('personal login round trip', () => {
  it('logs in, resolves a credential for a command, then logs out', async () => {
    const service = `agentteams-cli-roundtrip-${process.pid}`;
    const openStore = createRoundTripStoreFactory(service);
    const store = openStore();

    const pkce = createPkcePair();
    const tokenServer = await startTokenServer(pkce.challenge);
    const configPath = createProject({ teamId: 't', projectId: 'p', apiUrl: tokenServer.url });
    const callbackServer = await startAuthorizationCodeServer({ state: createAuthState() });
    const client = new PersonalTokenClient({
      apiUrl: tokenServer.url,
      store: createPersonalTokenStore(tokenServer.url, store),
    });

    try {
      // 1. The browser posts the authorization code back to the loopback port.
      const pending = callbackServer.waitForCallback();
      const callbackResponse = await fetch(`http://localhost:${callbackServer.port}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
        body: JSON.stringify({ code: 'atc_code', state: callbackServer.state }),
      });
      expect(callbackResponse.status).toBe(200);
      const callback = await pending;

      // 2. The code is redeemed with the verifier that never left this process.
      const session = await client.exchangeAuthorizationCode({
        code: callback.code,
        codeVerifier: pkce.verifier,
        redirectUri: `http://localhost:${callbackServer.port}/callback`,
      });
      expect(session.identity.email).toBe('dev@example.com');
      expect(setProjectAuthMode(configPath, 'personal-token')).toBe(true);

      // 3. A command resolves the personal token as its credential.
      const config = await loadConfigWithCredential(undefined, { getClient: () => client });
      expect(config?.credentialSource).toBe('personal-token');
      expect(config?.apiKey).toBe(session.accessToken);
      // The path is compared by suffix: macOS canonicalizes /var to /private/var.
      expect(findProjectConfig(process.cwd())).toMatch(/\.agentteams[\\/]config\.json$/);

      // Only the refresh token is persisted; the access token never is. Read
      // through a second store so the value has to come back out of storage.
      const stored = createPersonalTokenStore(tokenServer.url, openStore()).read();
      expect(stored).not.toBeNull();
      expect(stored).not.toBe(session.accessToken);
      expect(tokenServer.issued.has(stored as string)).toBe(true);

      // 4. Status: the credential is reported without exposing its value.
      const state = client.state();
      expect(state.connected).toBe(true);
      expect(state.reconnectRequired).toBe(false);
      expect(JSON.stringify(state)).not.toContain(session.accessToken);

      // 5. Logout revokes server-side first, then clears locally.
      await client.revoke();
      expect(tokenServer.revoked).toHaveLength(1);
      expect(client.hasCredential()).toBe(false);

      // The project falls back to whatever the old path left behind — here,
      // nothing, so a command reports "not configured" rather than half-working.
      expect(setProjectAuthMode(configPath, null)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).not.toHaveProperty('authMode');
      expect(await loadConfigWithCredential(undefined, { getClient: () => client })).toBeNull();
    } finally {
      if (callbackServer.server.listening) callbackServer.server.close();
      store.remove(`personal-refresh:${tokenServer.url}`);
      await tokenServer.close();
    }
  });

  it('keeps a legacy key_ project on the old path throughout', async () => {
    const tokenServer = await startTokenServer('unused-challenge');
    createProject({ teamId: 't', projectId: 'p', apiKey: 'key_legacy', apiUrl: tokenServer.url });

    try {
      const config = await loadConfigWithCredential(undefined, {
        getClient: () => {
          throw new Error('the legacy path must never construct a personal token client');
        },
      });

      expect(config).toMatchObject({ apiKey: 'key_legacy', credentialSource: 'config-api-key' });
    } finally {
      await tokenServer.close();
    }
  });
});
