import { createRequire } from 'node:module';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { handleError } from '../utils/errors.js';
import { resolveMcpToolContext, type McpToolContext } from './context.js';
import { getResourceSpecs } from './resources.js';
import { createCliContextToolsClient, getToolSpecs } from './tools.js';
import { getWriteToolSpecs } from './writeTools.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const MCP_SERVER_NAME = '@agentteams/cli';

/**
 * Build one MCP server instance. `serveStdio` calls this per connection (and
 * per discarded `server/discover` probe), so it must stay side-effect free
 * apart from stderr diagnostics.
 *
 * This module is the only place allowed to import the MCP SDK or assemble MCP
 * response envelopes: domain handlers stay SDK-agnostic so upgrading the
 * pinned beta only touches this adapter.
 */
export function createMcpServer(context: McpToolContext, version: string = pkg.version): McpServer {
  // Tools (read + document writes) plus single-entity resource templates.
  // Prompts and Extensions stay out of scope.
  const server = new McpServer({ name: MCP_SERVER_NAME, version }, { capabilities: { tools: {}, resources: {} } });
  registerTools(server, context);
  registerResources(server, context);
  return server;
}

/**
 * The single `registerTool` loop — tool envelopes are assembled only here.
 *
 * Read specs come from the shared `@agentteams/context-tools` package; write
 * specs are CLI-local by design (see `writeTools.ts`). Both are flattened to the
 * same `(args) => unknown` shape first so there is still exactly one loop.
 */
function registerTools(server: McpServer, context: McpToolContext): void {
  const client = createCliContextToolsClient(context);
  const readTools = getToolSpecs().map((spec) => ({
    ...spec,
    invoke: (args: Record<string, unknown>) => spec.handler(args, client),
  }));
  const writeTools = getWriteToolSpecs().map((spec) => ({
    ...spec,
    invoke: (args: Record<string, unknown>) => spec.handler(args, context),
  }));

  for (const spec of [...readTools, ...writeTools]) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
      },
      async (args: unknown) => {
        try {
          // The SDK has already validated `args` against `spec.inputSchema`
          // before this callback runs, so the record cast is safe.
          const result = await spec.invoke(args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          // API failures are reported as a tool error so the connection survives.
          return {
            content: [{ type: 'text' as const, text: handleError(error, { apiUrl: context.apiUrl }) }],
            isError: true,
          };
        }
      },
    );
  }
}

/**
 * The single `registerResource` loop — resource envelopes and JSON-RPC error
 * mapping live only here. Every template hides enumeration (`list: undefined`):
 * entity listing is the search/list tools' job, and a full dump would be
 * unbounded.
 */
function registerResources(server: McpServer, context: McpToolContext): void {
  for (const spec of getResourceSpecs()) {
    server.registerResource(
      spec.name,
      new ResourceTemplate(spec.uriTemplate, { list: undefined }),
      {
        title: spec.title,
        description: spec.description,
        mimeType: 'application/json',
      },
      async (uri, variables) => {
        try {
          const result = await spec.handler(normalizeVariables(variables), context);
          return {
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }],
          };
        } catch (error) {
          // Unlike tools (isError envelope), resource failures surface as
          // JSON-RPC errors: rethrow with the translated message and let the
          // SDK build the error frame — the connection itself survives.
          throw new Error(handleError(error, { apiUrl: context.apiUrl }));
        }
      },
    );
  }
}

/** The SDK hands template variables as `string | string[]`; specs expect plain strings. */
function normalizeVariables(variables: Record<string, string | string[]>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    normalized[key] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return normalized;
}

/**
 * Start the stdio MCP server. stdout is reserved for JSON-RPC frames, so every
 * diagnostic goes to stderr.
 */
export async function startMcpServer(options: Record<string, unknown> = {}): Promise<StdioServerHandle> {
  // Startup still resolves once — that is where the `${VAR}` and project-binding
  // refusals must happen, before a single tool is advertised. What changed is
  // that the credential inside the context can now be re-resolved per request.
  const context = await resolveMcpToolContext(options);

  writeDiagnostic(`serving stdio (cli ${pkg.version}) apiUrl=${context.apiUrl} projectId=${context.projectId}`);

  return serveStdio((ctx) => {
    // The era tells us whether the client negotiated the modern
    // (`server/discover`) or legacy (`initialize`) revision — the key
    // observation this spike has to record.
    writeDiagnostic(`connection era=${ctx.era}`);
    return createMcpServer(context);
  });
}

function writeDiagnostic(message: string): void {
  process.stderr.write(`[agentteams mcp] ${message}\n`);
}
