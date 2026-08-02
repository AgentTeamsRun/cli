import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { ToolProfile } from '@agentteams/context-tools';
import { createMcpServer, type McpToolContext } from '../../src/commands/mcp.js';

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const LEGACY_PROTOCOL_VERSION = '2025-11-25';

// The modern revision rejects any request whose `params._meta` omits these two
// keys with `-32602`, so the wire contract is asserted with literal keys rather
// than the SDK's own constants.
export const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'mcp-test-client', version: '0.0.0' },
};

export const TEST_TOOL_CONTEXT: McpToolContext = {
  apiUrl: 'http://localhost:3001',
  projectId: 'project-1',
  headers: { 'X-API-Key': 'key_test', 'Content-Type': 'application/json' },
};

export interface JsonRpcResponse {
  id: number;
  result?: Record<string, any>;
  error?: { code: number; message: string };
}

export interface McpTestClient {
  request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse>;
  notify(method: string, params: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal JSON-RPC client over the SDK's in-memory transport. Responses are
 * matched by request id because the server does not guarantee wire ordering.
 */
export function createTestClient(transport: InMemoryTransport): McpTestClient {
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

export function connect(
  context: McpToolContext = TEST_TOOL_CONTEXT,
  toolProfile: ToolProfile = 'full',
): {
  client: McpTestClient;
  handle: StdioServerHandle;
} {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => createMcpServer(context, '9.9.9', toolProfile), { transport: serverTransport });
  return { client: createTestClient(clientTransport), handle };
}

/** Run the modern discover handshake so tools/resources calls are accepted. */
export async function discover(client: McpTestClient): Promise<JsonRpcResponse> {
  return client.request('server/discover', { _meta: MODERN_META });
}

/** Run the legacy initialize + initialized handshake. */
export async function initializeLegacy(client: McpTestClient): Promise<JsonRpcResponse> {
  const initialize = await client.request('initialize', {
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mcp-test-client', version: '0.0.0' },
  });
  await client.notify('notifications/initialized', {});
  return initialize;
}
