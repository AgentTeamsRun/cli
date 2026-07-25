import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { searchEntities } from '../api/search.js';
import { getConfigurationNotFoundMessage, loadConfig } from '../utils/config.js';
import { buildConfigOverrides, resolveApiContext } from '../utils/apiContext.js';
import { handleError } from '../utils/errors.js';
import { buildSearchParams, VALID_TYPES } from '../utils/searchParams.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const MCP_SERVER_NAME = '@agentteams/cli';
export const SEARCH_TOOL_NAME = 'agentteams_search';

const SEARCH_TOOL_DESCRIPTION = [
  'Search AgentTeams entities (plans, co-actions, completion reports, post-mortems, conventions, comments, code reviews, documents) in this project.',
  'Scope: results are limited to the projectId configured for this CLI — the tool cannot search other projects.',
  'Truncation: when the token budget trims the response, meta.truncatedByTokenBudget is true; per-item contentTokenCount tells you what fetching the full entity would cost.',
  'Limitation: under agent API-key authentication the external issue/PR types (GITHUB_ISSUE, GITHUB_PR, GITLAB_ISSUE, GITLAB_MERGE_REQUEST, BITBUCKET_ISSUE, BITBUCKET_PR, LINEAR_ISSUE) always come back empty.',
].join(' ');

/** Everything a tool handler needs to reach the AgentTeams API. */
export interface McpToolContext {
  apiUrl: string;
  projectId: string;
  headers: Record<string, string>;
}

/**
 * Resolve credentials the same way every other command does.
 *
 * The MCP server is spawned by an external agent, so its cwd cannot be
 * trusted to sit inside the project: CLI overrides and `AGENTTEAMS_*`
 * environment variables are the reliable paths here.
 */
export function resolveMcpToolContext(options: Record<string, unknown> = {}): McpToolContext {
  const config = loadConfig(buildConfigOverrides(options));
  if (!config) {
    throw new Error(getConfigurationNotFoundMessage());
  }

  const { apiUrl, headers } = resolveApiContext(config);
  return { apiUrl, projectId: config.projectId, headers };
}

/**
 * Build one MCP server instance. `serveStdio` calls this per connection (and
 * per discarded `server/discover` probe), so it must stay side-effect free
 * apart from stderr diagnostics.
 */
export function createMcpServer(context: McpToolContext, version: string = pkg.version): McpServer {
  // Only `tools` is declared: resources, prompts and Extensions are out of
  // scope for the Phase 0 spike.
  const server = new McpServer({ name: MCP_SERVER_NAME, version }, { capabilities: { tools: {} } });
  registerSearchTool(server, context);
  return server;
}

function registerSearchTool(server: McpServer, context: McpToolContext): void {
  server.registerTool(
    SEARCH_TOOL_NAME,
    {
      title: 'Search AgentTeams',
      description: SEARCH_TOOL_DESCRIPTION,
      // 1:1 with the backend's searchQuerySchema. Defaults for limit/maxTokens
      // stay unset so the backend remains the single source of truth.
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query'),
        types: z.array(z.enum(VALID_TYPES)).optional().describe('Entity types to filter by'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results (backend default: 20)'),
        maxTokens: z.number().int().min(1).optional().describe('Token budget for the response'),
      }),
    },
    async (args) => {
      try {
        const response = await searchEntities(
          context.apiUrl,
          context.projectId,
          context.headers,
          buildSearchParams({
            query: args.query,
            types: args.types,
            limit: args.limit,
            maxTokens: args.maxTokens,
          }),
        );

        // The full payload is passed through verbatim: summarizing away `meta`
        // or `partialFailures` would let an agent read a truncated or partially
        // failed search as "no results".
        return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] };
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

/**
 * Start the stdio MCP server. stdout is reserved for JSON-RPC frames, so every
 * diagnostic goes to stderr.
 */
export function startMcpServer(options: Record<string, unknown> = {}): StdioServerHandle {
  const context = resolveMcpToolContext(options);

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
