import { createRequire } from 'node:module';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { handleError } from '../utils/errors.js';
import { resolveMcpToolContext } from './context.js';
import { getResourceSpecs } from './resources.js';
import { getProfileToolSpecs } from './catalog.js';
import { createCliContextToolsClient } from './tools.js';
import { parseToolProfile } from './toolProfile.js';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
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
export function createMcpServer(context, version = pkg.version, toolProfile = 'full') {
    // Tools (read + document writes) plus single-entity resource templates.
    // Prompts and Extensions stay out of scope.
    const server = new McpServer({ name: MCP_SERVER_NAME, version }, { capabilities: { tools: {}, resources: {} } });
    registerTools(server, context, toolProfile);
    registerResources(server, context, toolProfile);
    return server;
}
/**
 * The single `registerTool` loop — tool envelopes are assembled only here.
 *
 * Read specs come from the shared `@agentteams/context-tools` package; local and
 * write specs are CLI-local by design (see `localTools.ts` / `writeTools.ts`).
 * All three are flattened to the same `(args) => unknown` shape first so there
 * is still exactly one loop.
 */
function registerTools(server, context, toolProfile) {
    const client = createCliContextToolsClient(context);
    const profileSpecs = getProfileToolSpecs(toolProfile);
    const readTools = profileSpecs.readTools.map((spec) => ({
        ...spec,
        invoke: (args) => spec.handler(args, client),
    }));
    const contextTools = [...profileSpecs.localTools, ...profileSpecs.writeTools].map((spec) => ({
        ...spec,
        invoke: (args) => spec.handler(args, context),
    }));
    for (const spec of [...readTools, ...contextTools]) {
        server.registerTool(spec.name, {
            title: spec.title,
            description: spec.description,
            inputSchema: spec.inputSchema,
        }, async (args) => {
            try {
                // The SDK has already validated `args` against `spec.inputSchema`
                // before this callback runs, so the record cast is safe.
                const result = await spec.invoke(args);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            catch (error) {
                // API failures are reported as a tool error so the connection survives.
                return {
                    content: [{ type: 'text', text: handleError(error, { apiUrl: context.apiUrl }) }],
                    isError: true,
                };
            }
        });
    }
}
/**
 * The single `registerResource` loop — resource envelopes and JSON-RPC error
 * mapping live only here. Every template hides enumeration (`list: undefined`):
 * entity listing is the search/list tools' job, and a full dump would be
 * unbounded.
 */
function registerResources(server, context, toolProfile) {
    const includedReadTools = new Set(getProfileToolSpecs(toolProfile).readTools.map(({ name }) => name));
    for (const spec of getResourceSpecs().filter(({ toolName }) => includedReadTools.has(toolName))) {
        server.registerResource(spec.name, new ResourceTemplate(spec.uriTemplate, { list: undefined }), {
            title: spec.title,
            description: spec.description,
            mimeType: 'application/json',
        }, async (uri, variables) => {
            try {
                const result = await spec.handler(normalizeVariables(variables), context);
                return {
                    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }],
                };
            }
            catch (error) {
                // Unlike tools (isError envelope), resource failures surface as
                // JSON-RPC errors: rethrow with the translated message and let the
                // SDK build the error frame — the connection itself survives.
                throw new Error(handleError(error, { apiUrl: context.apiUrl }));
            }
        });
    }
}
/** The SDK hands template variables as `string | string[]`; specs expect plain strings. */
function normalizeVariables(variables) {
    const normalized = {};
    for (const [key, value] of Object.entries(variables)) {
        normalized[key] = Array.isArray(value) ? (value[0] ?? '') : value;
    }
    return normalized;
}
/**
 * Start the stdio MCP server. stdout is reserved for JSON-RPC frames, so every
 * diagnostic goes to stderr.
 */
export async function startMcpServer(options = {}) {
    // 프로필 오류는 자격 증명 확인이나 stdio 프레임보다 먼저 결정적으로 거부한다.
    const toolProfile = parseToolProfile(options.toolProfile);
    // Startup still resolves once — that is where the `${VAR}` and project-binding
    // refusals must happen, before a single tool is advertised. What changed is
    // that the credential inside the context can now be re-resolved per request.
    const context = await resolveMcpToolContext(options);
    writeDiagnostic(`serving stdio (cli ${pkg.version}) apiUrl=${context.apiUrl} projectId=${context.projectId} toolProfile=${toolProfile}`);
    return serveStdio((ctx) => {
        // The era tells us whether the client negotiated the modern
        // (`server/discover`) or legacy (`initialize`) revision — the key
        // observation this spike has to record.
        writeDiagnostic(`connection era=${ctx.era}`);
        return createMcpServer(context, pkg.version, toolProfile);
    });
}
function writeDiagnostic(message) {
    process.stderr.write(`[agentteams mcp] ${message}\n`);
}
//# sourceMappingURL=server.js.map