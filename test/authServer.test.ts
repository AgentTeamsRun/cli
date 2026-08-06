import { afterEach, describe, expect, it } from '@jest/globals';
import type { Server as HttpServer } from 'node:http';
import {
  createAuthState,
  parseUnifiedSetupPayload,
  SETUP_METADATA_MISSING_HINT,
  startLocalAuthServer,
  startUnifiedSetupServer,
} from '../src/utils/authServer.js';

const WEB_ORIGIN = 'https://web.test.agentteams.run';

const servers: HttpServer[] = [];
const pendingCallbacks: Promise<unknown>[] = [];
const originalWebUrl = process.env.AGENTTEAMS_WEB_URL;
const originalAllowedOrigins = process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS;

type CallbackPayload = Record<string, unknown>;

function validPayload(state: string): CallbackPayload {
  return {
    teamId: 'team_1',
    projectId: 'project_1',
    agentName: 'test-agent',
    apiKey: 'key_oauth_123',
    configId: '7',
    state,
  };
}

async function postCallback(
  port: number,
  body: CallbackPayload | string,
  headers: Record<string, string> = { Origin: WEB_ORIGIN },
): Promise<{ status: number; body: { message?: string; success?: boolean } }> {
  const response = await fetch(`http://localhost:${port}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  return { status: response.status, body: (await response.json()) as { message?: string; success?: boolean } };
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function startServer(): ReturnType<typeof startLocalAuthServer> {
  const context = await startLocalAuthServer();
  servers.push(context.server);
  return context;
}

beforeEach(() => {
  process.env.AGENTTEAMS_WEB_URL = WEB_ORIGIN;
  delete process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS;
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  // A rejected callback promise with no handler would surface as an unhandled
  // rejection once the server closes, so every started wait is drained here.
  await Promise.allSettled(pendingCallbacks.splice(0));

  if (originalWebUrl === undefined) {
    delete process.env.AGENTTEAMS_WEB_URL;
  } else {
    process.env.AGENTTEAMS_WEB_URL = originalWebUrl;
  }

  if (originalAllowedOrigins === undefined) {
    delete process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS;
  } else {
    process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS = originalAllowedOrigins;
  }
});

describe('createAuthState', () => {
  it('produces unguessable values well above the 16-character floor', () => {
    const first = createAuthState();
    const second = createAuthState();

    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(first).not.toBe(second);
  });
});

describe('startLocalAuthServer', () => {
  it('listens on an OS-assigned port instead of a fixed one', async () => {
    const [first, second] = await Promise.all([startServer(), startServer()]);

    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBeGreaterThan(0);
    expect(first.port).not.toBe(second.port);
    // The old implementation always started at 7777 and walked a fixed range.
    expect(first.port).not.toBe(7777);
  });

  it('issues a distinct state per login', async () => {
    const [first, second] = await Promise.all([startServer(), startServer()]);

    expect(first.state.length).toBeGreaterThanOrEqual(16);
    expect(first.state).not.toBe(second.state);
  });

  it('accepts a callback carrying the matching state', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, validPayload(context.state));

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({
      teamId: 'team_1',
      projectId: 'project_1',
      agentName: 'test-agent',
      apiKey: 'key_oauth_123',
      configId: '7',
    });
  });

  it('rejects a callback whose state does not match, without consuming the login', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const forged = await postCallback(context.port, validPayload('not-the-real-state'));
    expect(forged.status).toBe(400);

    // The genuine callback must still be accepted afterwards: a mismatch that
    // burned the single-use server would be a trivial denial of service.
    const genuine = await postCallback(context.port, validPayload(context.state));
    expect(genuine.status).toBe(200);
    await expect(pending).resolves.toEqual(expect.objectContaining({ apiKey: 'key_oauth_123' }));
  });

  it('rejects a callback with no state and points at the web page', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const payload = validPayload(context.state);
    delete payload.state;
    const response = await postCallback(context.port, payload);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('/cli/authorize');
    // The only cause is a web build older than this CLI; the hint has to say so,
    // because reloading the same page cannot fix an undeployed web.
    expect(response.body.message).toContain('older than this CLI');
  });

  it('rejects a callback from another origin with 403', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, validPayload(context.state), {
      Origin: 'https://attacker.example',
    });

    expect(response.status).toBe(403);
  });

  it('rejects a callback with no Origin header', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, validPayload(context.state), {});

    expect(response.status).toBe(403);
  });

  it('no longer trusts arbitrary localhost origins', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, validPayload(context.state), {
      Origin: 'http://localhost:31337',
    });

    expect(response.status).toBe(403);
  });

  it('allows an origin opted into explicitly through AGENTTEAMS_OAUTH_ALLOWED_ORIGINS', async () => {
    process.env.AGENTTEAMS_OAUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, validPayload(context.state), {
      Origin: 'http://localhost:3000',
    });

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual(expect.objectContaining({ apiKey: 'key_oauth_123' }));
  });

  it('drops an injected apiUrl from the accepted result', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    await postCallback(context.port, { ...validPayload(context.state), apiUrl: 'https://attacker.example' });

    const result = await pending;
    expect(result).not.toHaveProperty('apiUrl');
  });

  it('rejects a malformed payload', async () => {
    const context = await startServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, { teamId: 'team_1', state: context.state });

    expect(response.status).toBe(400);
  });
});

describe('startUnifiedSetupServer', () => {
  const setupPayload = (state: string): CallbackPayload => ({
    code: 'atc_authorization_code',
    state,
    teamId: 'team_1',
    projectId: 'project_1',
    configId: 'config_1',
    agentName: 'demo-agent',
    seedPlanId: 'seed_1',
  });

  async function startSetupServer(): ReturnType<typeof startUnifiedSetupServer> {
    const context = await startUnifiedSetupServer();
    servers.push(context.server);
    return context;
  }

  it('accepts the code plus the connection identifiers', async () => {
    const context = await startSetupServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    const response = await postCallback(context.port, setupPayload(context.state));

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({
      code: 'atc_authorization_code',
      state: context.state,
      teamId: 'team_1',
      projectId: 'project_1',
      configId: 'config_1',
      agentName: 'demo-agent',
      seedPlanId: 'seed_1',
    });
  });

  it('drops fields the CLI does not trust, apiKey and apiUrl included', async () => {
    const context = await startSetupServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    await postCallback(context.port, {
      ...setupPayload(context.state),
      apiKey: 'key_should_not_travel',
      apiUrl: 'https://attacker.example',
      refreshToken: 'rt_should_not_travel',
    });

    const result = (await pending) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual([
      'agentName',
      'code',
      'configId',
      'projectId',
      'seedPlanId',
      'state',
      'teamId',
    ]);
  });

  it('reports a plain login callback from an older web as metadata-missing', async () => {
    const context = await startSetupServer();
    const pending = context.waitForCallback();
    pendingCallbacks.push(pending);

    // 구 web은 flow=setup을 모르고 순수 인가코드 분기로 떨어져 {code,state}만 돌려준다.
    const response = await postCallback(context.port, { code: 'atc_authorization_code', state: context.state });

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({ metadataMissing: true });
  });

  it('rejects a payload with no authorization code at all', () => {
    expect(parseUnifiedSetupPayload({ teamId: 'team_1', state: 'state' })).toBeNull();
    expect(parseUnifiedSetupPayload('not-an-object')).toBeNull();
  });

  it('treats a blank connection identifier as metadata-missing rather than accepting it', () => {
    expect(
      parseUnifiedSetupPayload({
        code: 'atc_code',
        state: 'state',
        teamId: 'team_1',
        projectId: '',
        configId: 'config_1',
        agentName: 'demo-agent',
      }),
    ).toEqual({ metadataMissing: true });
  });

  it('explains that the web deploy is behind and that nothing was consumed', () => {
    expect(SETUP_METADATA_MISSING_HINT).toContain('older than this CLI');
    expect(SETUP_METADATA_MISSING_HINT).toContain('agentteams init');
    expect(SETUP_METADATA_MISSING_HINT).toContain('discarded');
  });
});
