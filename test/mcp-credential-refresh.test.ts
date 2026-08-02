import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { getActiveCredential, resetActiveCredentialForTests } from '../src/auth/activeCredential.js';
import { PersonalTokenClient } from '../src/auth/personalTokenClient.js';
import type { PersonalTokenStore } from '../src/auth/personalTokenStore.js';
import { createCliContextToolsClient } from '../src/mcp/tools.js';
import { resolveMcpToolContext, type McpToolContext } from '../src/mcp/context.js';
import { MODERN_META, connect, discover } from './helpers/mcp.js';

const API_URL = 'http://localhost:3001';
const PROJECT_ID = 'project-1';

let openHandle: StdioServerHandle | undefined;
let originalEnv: NodeJS.ProcessEnv | undefined;

afterEach(async () => {
  if (openHandle) {
    await openHandle.close();
    openHandle = undefined;
  }
  if (originalEnv) {
    process.env = originalEnv;
    originalEnv = undefined;
  }
  resetActiveCredentialForTests();
  jest.restoreAllMocks();
});

/**
 * A context whose credential expires, the way `agentteams mcp` actually behaves
 * over a long session: the startup headers go stale and every later call has to
 * pick up the refreshed token.
 */
function expiringContext(tokens: string[]): { context: McpToolContext; resolveCount: () => number } {
  let index = 0;
  let resolveCount = 0;
  return {
    context: {
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      headers: { Authorization: `Bearer ${tokens[0]}`, 'Content-Type': 'application/json' },
      resolveHeaders: async () => {
        resolveCount += 1;
        const token = tokens[Math.min(index++, tokens.length - 1)];
        return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      },
    },
    resolveCount: () => resolveCount,
  };
}

function tokenStore(value: string | null): PersonalTokenStore {
  let stored = value;
  return {
    status: () => ({ backend: 'macos-keychain', persisted: true, reason: 'OK' }),
    read: () => stored,
    save: (token: string) => {
      stored = token;
      return { persisted: true, reason: 'OK' };
    },
    remove: () => {
      stored = null;
    },
  };
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('MCP credential resolution boundary', () => {
  function scriptedClient(tokens: Array<string | null>) {
    let index = 0;
    let identity: { memberId: string } | null = null;
    return {
      hasCredential: () => true,
      getAccessToken: jest.fn(async () => {
        const token = tokens[Math.min(index++, tokens.length - 1)] ?? null;
        if (token) identity = { memberId: 'member-1' };
        return token;
      }),
      invalidateAccessToken: jest.fn(),
      state: () => ({ identity }),
    };
  }

  async function resolveScriptedContext(tokens: Array<string | null>): Promise<McpToolContext> {
    originalEnv = { ...process.env };
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    process.env.AGENTTEAMS_API_URL = API_URL;
    process.env.AGENTTEAMS_TEAM_ID = 'team-1';
    process.env.AGENTTEAMS_PROJECT_ID = PROJECT_ID;
    process.env.AGENTTEAMS_MCP_BINDING_SOURCE = 'desktop';
    process.env.AGENTTEAMS_MCP_MEMBER_ID = 'member-1';

    const client = scriptedClient(tokens);
    return resolveMcpToolContext({}, { getClient: () => client as never });
  }

  async function resolveInjectedPersonalTokenContext(includeIdentity = true): Promise<McpToolContext> {
    originalEnv = { ...process.env };
    process.env.AGENTTEAMS_API_KEY = 'atp_desktop_snapshot';
    process.env.AGENTTEAMS_API_URL = API_URL;
    process.env.AGENTTEAMS_TEAM_ID = 'team-1';
    process.env.AGENTTEAMS_PROJECT_ID = PROJECT_ID;
    process.env.AGENTTEAMS_MCP_BINDING_SOURCE = 'desktop';
    if (includeIdentity) process.env.AGENTTEAMS_MCP_MEMBER_ID = 'member-1';
    else delete process.env.AGENTTEAMS_MCP_MEMBER_ID;

    const client = new PersonalTokenClient({
      apiUrl: API_URL,
      store: tokenStore('atr_cli_refresh'),
      now: () => 0,
      fetch: (async () =>
        jsonResponse({
          data: {
            accessToken: 'atp_cli_refreshed',
            refreshToken: 'atr_cli_rotated',
            expiresIn: 900,
            identity: { memberId: 'member-1', email: 'member@example.com', nickname: 'member' },
          },
        })) as unknown as typeof fetch,
    });
    return resolveMcpToolContext({}, { getClient: () => client });
  }

  it('keeps an injected atp_ static when the identity gate cannot be evaluated', async () => {
    const context = await resolveInjectedPersonalTokenContext(false);

    expect(context.resolveHeaders).toBeUndefined();
  });

  it('adds a per-call header resolver for an injected atp_', async () => {
    const context = await resolveInjectedPersonalTokenContext();

    expect(context.resolveHeaders).toBeDefined();
    await expect(context.resolveHeaders?.()).resolves.toEqual({
      Authorization: 'Bearer atp_cli_refreshed',
      'Content-Type': 'application/json',
    });
  });

  it('keeps a resolver after a transient startup failure and rearms on recovery', async () => {
    const context = await resolveScriptedContext([null, 'atp_recovered']);

    expect(context.resolveHeaders).toBeDefined();
    expect(getActiveCredential()).not.toBeNull();
    await expect(context.resolveHeaders?.()).resolves.toEqual({
      Authorization: 'Bearer atp_recovered',
      'Content-Type': 'application/json',
    });
    expect(getActiveCredential()).not.toBeNull();
  });

  it('rearms the 401 retry after a runtime failure recovers', async () => {
    const context = await resolveScriptedContext(['atp_initial', null, 'atp_recovered']);

    expect(getActiveCredential()).not.toBeNull();
    await expect(context.resolveHeaders?.()).resolves.toEqual({
      Authorization: 'Bearer atp_desktop_snapshot',
      'Content-Type': 'application/json',
    });
    expect(getActiveCredential()).not.toBeNull();
    await expect(context.resolveHeaders?.()).resolves.toEqual({
      Authorization: 'Bearer atp_recovered',
      'Content-Type': 'application/json',
    });
    expect(getActiveCredential()).not.toBeNull();
  });

  it('resolves the credential per tool call rather than once at startup', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: 'plan-1' } } } as never);
    const { context, resolveCount } = expiringContext(['atp_first', 'atp_second', 'atp_third']);
    const client = createCliContextToolsClient(context);

    await client.getPlan('plan-1');
    await client.getPlan('plan-1');
    await client.getPlan('plan-1');

    expect(resolveCount()).toBe(3);
    // The token that expired at startup is not what the third call sent.
    expect(
      getSpy.mock.calls.map((call) => (call[1] as { headers: Record<string, string> }).headers.Authorization),
    ).toEqual(['Bearer atp_first', 'Bearer atp_second', 'Bearer atp_third']);
  });

  it('succeeds on a call made after the startup token would have expired', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockImplementation((async (_url: string, config: unknown) => {
      const authorization = (config as { headers: Record<string, string> }).headers.Authorization;
      // The server would reject the expired token; only the refreshed one works.
      if (authorization === 'Bearer atp_expired') {
        throw Object.assign(new Error('Request failed with status code 401'), { isAxiosError: true });
      }
      return { data: { data: { id: 'coaction-1' } } };
    }) as never);

    const { context } = expiringContext(['atp_expired', 'atp_refreshed']);
    // The first resolve returns the expired token, matching a server that has
    // just started; the next call gets the refreshed one.
    const client = createCliContextToolsClient(context);

    await expect(client.getCoAction('coaction-1')).rejects.toThrow(/401/);
    await expect(client.getCoAction('coaction-1')).resolves.toEqual({ data: { id: 'coaction-1' } });
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the startup headers unchanged when the credential cannot expire', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: 'plan-1' } } } as never);
    const staticContext: McpToolContext = {
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      headers: { 'X-API-Key': 'key_legacy', 'Content-Type': 'application/json' },
    };

    await createCliContextToolsClient(staticContext).getPlan('plan-1');

    expect(getSpy).toHaveBeenCalledWith(expect.any(String), { headers: staticContext.headers });
  });

  it('serves a tool call end to end with a refreshed credential', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: { id: 'plan-1' } } } as never);
    const { context } = expiringContext(['atp_expired', 'atp_refreshed']);
    const { client, handle } = connect(context);
    openHandle = handle;

    await discover(client);
    // Two calls: the first consumes the stale token, the second must not.
    await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'plan-1' },
      _meta: MODERN_META,
    });
    const second = await client.request('tools/call', {
      name: 'agentteams_plan_get',
      arguments: { id: 'plan-1' },
      _meta: MODERN_META,
    });

    expect(second.result?.isError).toBeFalsy();
    const lastHeaders = (getSpy.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }).headers;
    expect(lastHeaders.Authorization).toBe('Bearer atp_refreshed');
  });
});
