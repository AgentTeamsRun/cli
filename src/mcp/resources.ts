import type { McpToolContext } from './context.js';
import { createCliContextToolsClient, getToolSpecs, type McpToolSpec } from './tools.js';

/**
 * SDK-agnostic resource-template description. The handler receives the URI
 * template variables and returns the upstream payload verbatim; only the SDK
 * adapter (`server.ts`) may build `ResourceTemplate` instances or the
 * `contents` envelope.
 */
export interface McpResourceSpec {
  name: string;
  uriTemplate: string;
  title: string;
  description: string;
  handler: (variables: Record<string, string>, context: McpToolContext) => Promise<unknown>;
}

function findToolSpec(name: string): McpToolSpec {
  const spec = getToolSpecs().find((tool) => tool.name === name);
  if (!spec) {
    throw new Error(`MCP resource wiring error: tool spec not found: ${name}`);
  }
  return spec;
}

/**
 * Resource read data comes from the very same domain handler the matching tool
 * uses — a resource read and a tool call for the same id must stay deep-equal,
 * so no resource assembles its own payload.
 */
function createEntityResourceSpec(options: {
  name: string;
  uriTemplate: string;
  title: string;
  description: string;
  toolName: string;
}): McpResourceSpec {
  const toolSpec = findToolSpec(options.toolName);
  return {
    name: options.name,
    uriTemplate: options.uriTemplate,
    title: options.title,
    description: options.description,
    handler: (variables, context) => toolSpec.handler({ id: variables.id }, createCliContextToolsClient(context)),
  };
}

/** The three single-entity URI templates. Full enumeration is intentionally not offered. */
export function getResourceSpecs(): McpResourceSpec[] {
  return [
    createEntityResourceSpec({
      name: 'agentteams-plan',
      uriTemplate: 'agentteams://plan/{id}',
      title: 'AgentTeams Plan',
      description:
        'Full plan runbook (metadata, contentMarkdown, V2 tasks, progress) as JSON. Same payload as the agentteams_plan_get tool.',
      toolName: 'agentteams_plan_get',
    }),
    createEntityResourceSpec({
      name: 'agentteams-document',
      uriTemplate: 'agentteams://document/{id}',
      title: 'AgentTeams Document',
      description: 'Full document (body included) as JSON. Same payload as the agentteams_document_get tool.',
      toolName: 'agentteams_document_get',
    }),
    createEntityResourceSpec({
      name: 'agentteams-convention',
      uriTemplate: 'agentteams://convention/{id}',
      title: 'AgentTeams Convention',
      description:
        'Full convention (contentMarkdown included) as JSON. Same payload as the agentteams_convention_get tool.',
      toolName: 'agentteams_convention_get',
    }),
  ];
}
