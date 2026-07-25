import { getConfigurationNotFoundMessage, loadConfig } from '../utils/config.js';
import { buildConfigOverrides, resolveApiContext } from '../utils/apiContext.js';

/** Everything a tool handler needs to reach the AgentTeams API. */
export interface McpToolContext {
  apiUrl: string;
  projectId: string;
  headers: Record<string, string>;
}

/**
 * MCP clients substitute `${VAR}` references in their server config before
 * spawning the process. When that substitution does not happen (unsupported
 * client, missing variable), the literal `${AGENTTEAMS_API_KEY}` string leaks
 * through as a non-empty credential, the server boots, and every call fails
 * with 401 — so unresolved placeholders must fail at startup instead.
 */
const UNRESOLVED_PLACEHOLDER = /\$\{[^}]*\}/;

const CREDENTIAL_ENV_HINTS: Record<string, string> = {
  apiKey: 'AGENTTEAMS_API_KEY',
  projectId: 'AGENTTEAMS_PROJECT_ID',
  teamId: 'AGENTTEAMS_TEAM_ID',
};

function assertNoUnresolvedPlaceholders(credentials: Record<string, string>): void {
  const offending = Object.entries(credentials)
    .filter(([, value]) => UNRESOLVED_PLACEHOLDER.test(value))
    .map(([key]) => key);

  if (offending.length === 0) return;

  const hints = offending.map((key) => `${key} (${CREDENTIAL_ENV_HINTS[key]})`).join(', ');
  throw new Error(
    `Unresolved \${...} placeholder in credential(s): ${hints}. ` +
      'The MCP client did not substitute environment variables in its server config. ' +
      'Set literal values for the AGENTTEAMS_* environment variables (or pass --api-key/--project-id/--team-id).',
  );
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

  assertNoUnresolvedPlaceholders({
    apiKey: config.apiKey,
    projectId: config.projectId,
    teamId: config.teamId,
  });

  const { apiUrl, headers } = resolveApiContext(config);
  return { apiUrl, projectId: config.projectId, headers };
}
