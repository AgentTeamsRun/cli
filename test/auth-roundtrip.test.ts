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
import { createPersonalTokenStore, personalTokenSlot } from '../src/auth/personalTokenStore.js';
import { createFileRefreshLock } from '../src/auth/refreshLock.js';
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
  /** Tokens that were valid and have since been rotated away. */
  retired: Set<string>;
  /** How many times reuse detection has revoked the whole family. */
  familyRevocations: () => number;
};

function startTokenServer(expectedChallenge: string): Promise<TokenServer> {
  const issued = new Set<string>();
  const retired = new Set<string>();
  const revoked: string[] = [];
  let counter = 0;
  let familyRevocations = 0;

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
          // What `rotatePersonalRefreshToken` does on reuse: a token that was
          // valid and has already been rotated away is evidence the credential
          // is duplicated, so the **whole family** is revoked, not just this
          // token. This is the blast radius that makes stale-token rotation a
          // full logout across every process rather than one failed command.
          if (retired.has(body.refreshToken)) {
            familyRevocations += 1;
            issued.clear();
            send(401, { error: 'invalid_grant', reason: 'reused' });
            return;
          }
          send(401, { error: 'invalid_grant', reason: 'UNKNOWN' });
          return;
        }
        issued.delete(body.refreshToken);
        retired.add(body.refreshToken);
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
        retired,
        familyRevocations: () => familyRevocations,
      });
    });
  });
}

/**
 * A stand-in backend: the same `CredentialStore` wrapper driven by a scripted
 * `security` runner, so the store's own caching and trailing-newline handling
 * stay in the loop while the OS is not involved.
 *
 * Returns a factory rather than one store: every instance shares the backend but
 * has its own read cache, which is what lets a test prove a value came back from
 * storage instead of from memory. Whether each platform's commands are assembled
 * correctly is `credentialStore.test.ts`'s job.
 */
function createStandInStoreFactory(service: string): () => CredentialStore {
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

/**
 * A credential store that always persists, preferring the real OS one.
 *
 * The real store is what the CLI actually ships into, so the full round trip uses
 * it when the machine has a working one. CI runners are headless — no Secret
 * Service on Linux — and there a login that cannot be stored is aborted by
 * design, which would leave the test asserting the failure path instead of the
 * round trip, so the stand-in takes over.
 */
function createRoundTripStoreFactory(service: string): () => CredentialStore {
  // The file fallback would persist anywhere, which would make this pick the real
  // store on a headless runner and quietly stop exercising the OS backend at all.
  // This probe is specifically "does this machine have a working *OS* store".
  const osOnly = { service, env: { AGENTTEAMS_DISABLE_FILE_CREDENTIALS: '1' } };
  if (createCredentialStore(osOnly).status().persisted) {
    return () => createCredentialStore(osOnly);
  }
  return createStandInStoreFactory(service);
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

  /**
   * The failure this guards against: one credential slot is shared by every
   * `agentteams` process — one-shot commands next to a long-lived `agentteams
   * mcp` — and each of them rotates the refresh token. A process that presents
   * the copy it read before someone else rotated triggers the server's reuse
   * detection, which revokes the whole family and logs every process out at
   * once, recoverable only by a fresh `agentteams auth login`.
   */
  describe('two processes sharing one credential slot', () => {
    /** Each case starts an HTTP server and drives three processes through it. */
    const RACE_TEST_TIMEOUT_MS = 30_000;

    type Processes = {
      tokenServer: TokenServer;
      slot: string;
      /** A process whose read cache already holds the pre-rotation token. */
      openProcess: () => PersonalTokenClient;
      cleanup: () => Promise<void>;
    };

    /**
     * Deliberately the stand-in backend rather than the real OS store: what is
     * under test is the store's per-process read cache and the rotation lock, not
     * any platform's credential tool. Windows would otherwise spawn a WinRT
     * PowerShell per read and per write — roughly a second each — and these tests
     * do dozens of them across three processes.
     */
    async function startProcesses(): Promise<Processes> {
      const service = `agentteams-cli-race-${process.pid}`;
      const openStore = createStandInStoreFactory(service);
      const lockDirectory = mkdtempSync(join(tmpdir(), 'agentteams-race-lock-'));
      tempDirs.push(lockDirectory);

      const pkce = createPkcePair();
      const tokenServer = await startTokenServer(pkce.challenge);
      const slot = personalTokenSlot(tokenServer.url);

      // A completed login seeds the slot with the family's first refresh token.
      await new PersonalTokenClient({
        apiUrl: tokenServer.url,
        store: createPersonalTokenStore(tokenServer.url, openStore()),
      }).exchangeAuthorizationCode({
        code: 'atc_code',
        codeVerifier: pkce.verifier,
        redirectUri: 'http://localhost:1/callback',
      });

      return {
        tokenServer,
        slot,
        openProcess: () => {
          // Its own store instance, so it has its own read cache — the thing
          // that makes one process's view of the slot go stale.
          const client = new PersonalTokenClient({
            apiUrl: tokenServer.url,
            store: createPersonalTokenStore(tokenServer.url, openStore()),
            lock: createFileRefreshLock(slot, { directory: lockDirectory }),
          });
          // Every command starts by checking for a credential, which is what
          // populates the cache that later goes stale.
          expect(client.hasCredential()).toBe(true);
          return client;
        },
        cleanup: async () => {
          openStore().remove(slot);
          await tokenServer.close();
        },
      };
    }

    it(
      'lets a process rotate after another one already did',
      async () => {
        const { tokenServer, openProcess, cleanup } = await startProcesses();

        try {
          const command = openProcess();
          const mcp = openProcess();

          // The one-shot command rotates first; the MCP server's cached copy of
          // the refresh token is now the superseded one.
          const commandToken = await command.getAccessToken();
          expect(commandToken).not.toBeNull();

          const mcpToken = await mcp.getAccessToken();

          expect(mcpToken).not.toBeNull();
          expect(mcpToken).not.toBe(commandToken);
          expect(tokenServer.familyRevocations()).toBe(0);
          expect(mcp.state().reconnectRequired).toBe(false);
        } finally {
          await cleanup();
        }
      },
      RACE_TEST_TIMEOUT_MS,
    );

    it(
      'serializes concurrent rotations instead of revoking the family',
      async () => {
        const { tokenServer, openProcess, cleanup } = await startProcesses();

        try {
          const processes = [openProcess(), openProcess(), openProcess()];

          const tokens = await Promise.all(processes.map((client) => client.getAccessToken()));

          expect(tokens.every((token) => typeof token === 'string')).toBe(true);
          expect(new Set(tokens).size).toBe(processes.length);
          expect(tokenServer.familyRevocations()).toBe(0);
          // Exactly one live refresh token is left: the last rotation's.
          expect(tokenServer.issued.size).toBe(1);
        } finally {
          await cleanup();
        }
      },
      RACE_TEST_TIMEOUT_MS,
    );

    it(
      'still works for the next command after every process has rotated',
      async () => {
        const { tokenServer, openProcess, cleanup } = await startProcesses();

        try {
          const mcp = openProcess();
          await mcp.getAccessToken();
          await openProcess().getAccessToken();

          // The MCP server's access token expires and it rotates again — the exact
          // point at which the stale cached refresh token used to kill the family.
          mcp.invalidateAccessToken();
          expect(await mcp.getAccessToken()).not.toBeNull();

          expect(tokenServer.familyRevocations()).toBe(0);
          expect(openProcess().hasCredential()).toBe(true);
        } finally {
          await cleanup();
        }
      },
      RACE_TEST_TIMEOUT_MS,
    );

    it(
      'models a server that does revoke the family when a retired token is replayed',
      async () => {
        // Without this the tests above would pass against a harness with no teeth.
        const { tokenServer, openProcess, cleanup } = await startProcesses();

        try {
          const retiredBefore = [...tokenServer.issued];
          await openProcess().getAccessToken();

          const replay = await fetch(`${tokenServer.url}/api/auth/desktop/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grantType: 'refresh_token',
              clientId: 'agentteams-cli',
              refreshToken: retiredBefore[0],
            }),
          });

          expect(replay.status).toBe(401);
          expect(await replay.json()).toMatchObject({ error: 'invalid_grant', reason: 'reused' });
          expect(tokenServer.familyRevocations()).toBe(1);
          // Every process is now locked out, which is the outcome the lock prevents.
          expect(tokenServer.issued.size).toBe(0);
        } finally {
          await cleanup();
        }
      },
      RACE_TEST_TIMEOUT_MS,
    );
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
