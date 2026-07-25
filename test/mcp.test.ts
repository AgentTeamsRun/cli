import { describe, it, expect, afterEach, jest } from '@jest/globals';
import axios from 'axios';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpServer, SEARCH_TOOL_NAME, type McpToolContext } from '../src/commands/mcp.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2025-11-25';

// The modern revision rejects any request whose `params._meta` omits these two
// keys with `-32602`, so the wire contract is asserted with literal keys rather
// than the SDK's own constants.
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'mcp-test-client', version: '0.0.0' },
};

// Shaped after api/src/schemas/search.ts (searchResponseSchema): `data` items,
// top-level `partialFailures`, and the four `meta` fields.
const searchResponse = {
  data: [
    {
      entityType: 'PLAN',
      id: 'plan-1',
      title: 'MCP Phase 0 spike',
      snippet: 'stdio MCP server',
      status: 'IN_PROGRESS',
      rank: 0.87,
      contentTokenCount: 1240,
      createdAt: '2026-07-25T00:00:00.000Z',
      htmlUrl: 'https://agentteams.run/go?type=plan&id=plan-1',
    },
  ],
  partialFailures: [{ provider: 'GITHUB', message: 'not connected' }],
  meta: { total: 1, truncatedByTokenBudget: true, semanticEnabled: false, availableProviders: [] },
};

const toolContext: McpToolContext = {
  apiUrl: 'http://localhost:3001',
  projectId: 'project-1',
  headers: { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' },
};

interface JsonRpcResponse {
  id: number;
  result?: Record<string, any>;
  error?: { code: number; message: string };
}

/**
 * Minimal JSON-RPC client over the SDK's in-memory transport. Responses are
 * matched by request id because the server does not guarantee wire ordering.
 */
function createTestClient(transport: InMemoryTransport) {
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let nextId = 1;

  transport.onmessage = (message: any) => {
    const resolve = typeof message?.id === 'number' ? pending.get(message.id) : undefined;
    if (resolve) {
      pending.delete(message.id);
      resolve(message as JsonRpcResponse);
    }
  };

  return {
    request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
      const id = nextId++;
      return new Promise<JsonRpcResponse>((resolve) => {
        pending.set(id, resolve);
        void transport.send({ jsonrpc: '2.0', id, method, params } as any);
      });
    },
    notify(method: string, params: Record<string, unknown>): Promise<void> {
      return transport.send({ jsonrpc: '2.0', method, params } as any);
    },
  };
}

function connect(): { client: ReturnType<typeof createTestClient>; handle: StdioServerHandle } {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createMcpServer(toolContext, '9.9.9'), { transport: serverTransport });
  return { client: createTestClient(clientTransport), handle };
}

describe('agentteams mcp stdio server', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  it('serves the modern revision (2026-07-28) via server/discover', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    const discover = await client.request('server/discover', { _meta: MODERN_META });

    expect(discover.error).toBeUndefined();
    expect(discover.result?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(discover.result?.capabilities?.tools).toBeDefined();

    const list = await client.request('tools/list', { _meta: MODERN_META });

    expect(list.error).toBeUndefined();
    expect(Array.isArray(list.result?.tools)).toBe(true);
  });

  it('serves the legacy revision (2025-11-25) via initialize', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    const initialize = await client.request('initialize', {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-test-client', version: '0.0.0' },
    });

    expect(initialize.error).toBeUndefined();
    expect(initialize.result?.protocolVersion).toBe(LEGACY_PROTOCOL_VERSION);
    expect(initialize.result?.capabilities?.tools).toBeDefined();
    expect(initialize.result?.serverInfo?.name).toBe('@agentteams/cli');
    expect(initialize.result?.serverInfo?.version).toBe('9.9.9');

    await client.notify('notifications/initialized', {});

    const list = await client.request('tools/list', {});

    expect(list.error).toBeUndefined();
    expect(Array.isArray(list.result?.tools)).toBe(true);
  });

  it('exposes agentteams_search with the backend input contract', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    await client.request('server/discover', { _meta: MODERN_META });
    const list = await client.request('tools/list', { _meta: MODERN_META });

    const tool = list.result?.tools?.find((entry: any) => entry.name === SEARCH_TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toEqual(['query']);
    expect(tool.inputSchema.properties.limit).toMatchObject({ minimum: 1, maximum: 100 });
    expect(tool.inputSchema.properties.types.items.enum).toContain('PLAN');
    expect(tool.description).toContain('truncatedByTokenBudget');
  });

  it('passes the whole search response through on the modern path', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: searchResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await client.request('server/discover', { _meta: MODERN_META });
    const call = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp', types: ['PLAN'], limit: 5, maxTokens: 2000 },
      _meta: MODERN_META,
    });

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();

    const [url] = getSpy.mock.calls[0] as [string];
    expect(url).toBe(
      `${toolContext.apiUrl}/api/projects/${toolContext.projectId}/search?q=mcp&types=PLAN&limit=5&maxTokens=2000`,
    );

    // meta / partialFailures / contentTokenCount must survive verbatim: an
    // agent that loses them reads a truncated search as "no results".
    expect(JSON.parse(call.result?.content[0].text)).toEqual(searchResponse);
  });

  it('serves tools/call on the legacy path too', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: searchResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await client.request('initialize', {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-test-client', version: '0.0.0' },
    });
    await client.notify('notifications/initialized', {});

    const call = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp' },
    });

    expect(call.error).toBeUndefined();
    expect(JSON.parse(call.result?.content[0].text).meta.total).toBe(1);
  });

  it('returns a tool error for an invalid type and keeps serving', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: searchResponse } as never);
    const { client, handle } = connect();
    openHandle = handle;

    await client.request('server/discover', { _meta: MODERN_META });
    const rejected = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp', types: ['NOT_A_TYPE'] },
      _meta: MODERN_META,
    });

    expect(rejected.result?.isError).toBe(true);
    expect(rejected.result?.content[0].text).toContain('validation error');

    const accepted = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp' },
      _meta: MODERN_META,
    });

    expect(accepted.result?.isError).toBeFalsy();
  });

  it('maps an API failure to a tool error without killing the server', async () => {
    const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid authentication token' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(unauthorized as never);
    getSpy.mockResolvedValue({ data: searchResponse } as never);

    const { client, handle } = connect();
    openHandle = handle;

    await client.request('server/discover', { _meta: MODERN_META });
    const failed = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp' },
      _meta: MODERN_META,
    });

    expect(failed.result?.isError).toBe(true);
    expect(failed.result?.content[0].text).toContain('API key');

    const recovered = await client.request('tools/call', {
      name: SEARCH_TOOL_NAME,
      arguments: { query: 'mcp' },
      _meta: MODERN_META,
    });

    expect(recovered.result?.isError).toBeFalsy();
  });

  it('rejects a modern request whose _meta envelope is incomplete', async () => {
    const { client, handle } = connect();
    openHandle = handle;

    const discover = await client.request('server/discover', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION },
    });

    expect(discover.error?.code).toBe(-32602);
  });

  it('never writes to stdout while serving a session', async () => {
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { client, handle } = connect();
    openHandle = handle;

    await client.request('server/discover', { _meta: MODERN_META });
    await client.request('tools/list', { _meta: MODERN_META });

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
