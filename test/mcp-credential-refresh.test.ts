import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createCliContextToolsClient } from '../src/mcp/tools.js';
import type { McpToolContext } from '../src/mcp/context.js';
import { MODERN_META, connect, discover } from './helpers/mcp.js';

const API_URL = 'http://localhost:3001';
const PROJECT_ID = 'project-1';

let openHandle: StdioServerHandle | undefined;

afterEach(async () => {
  if (openHandle) {
    await openHandle.close();
    openHandle = undefined;
  }
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

describe('MCP credential resolution boundary', () => {
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
