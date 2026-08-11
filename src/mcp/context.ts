import { getActiveCredential } from '../auth/activeCredential.js';
import {
  getConfigurationNotFoundMessage,
  loadConfigWithCredential,
  loadProjectConfig,
  type ResolveCredentialDeps,
} from '../utils/config.js';
import { buildAuthHeaders, buildConfigOverrides, resolveApiContext } from '../utils/apiContext.js';
import { findGuideProjectRoot } from './guides.js';
import { resolveSessionAgentConfigId } from '../utils/agentIdentity.js';

/** Everything a tool handler needs to reach the AgentTeams API. */
export interface McpToolContext {
  apiUrl: string;
  projectId: string;
  /**
   * Credentials as of server start. For a long-lived agent key this is the whole
   * story; for a credential that expires it is only the first value.
   */
  headers: Record<string, string>;
  /**
   * Absolute root of the local checkout this session is bound to, when there is
   * one. Present only if a local `.agentteams/config.json` names the same project
   * the tools write to — an MCP server spawned from an arbitrary cwd may sit
   * outside the project, or inside a different one, and reading that project's
   * guides would hand the agent the wrong rules and the wrong `guideHash`.
   * Absent means "no verified local copy": guide reads fall back to the server.
   */
  projectRoot?: string;
  /**
   * Which agent config (tool) this MCP session runs as, when the daemon spawned it.
   *
   * The tool axis of attribution: with a personal token the request carries no proven
   * agent identity, so without this the record silently loses "what it was written
   * with". Absent outside a daemon-spawned session — write tools must then omit the
   * field entirely rather than send an empty value.
   */
  agentConfigId?: string;
  /**
   * Present only when the credential can go stale.
   *
   * `agentteams mcp` runs for hours while a personal access token lives 15
   * minutes, so resolving once at startup would make every later tool call 401.
   * Tool handlers must call this instead of reading {@link headers} directly.
   * It is cheap: the access token is cached in memory and only re-fetched inside
   * the refresh window, so the credential store is not touched per call.
   */
  resolveHeaders?: () => Promise<Record<string, string>>;
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

export const MCP_BINDING_SOURCE_ENV = 'AGENTTEAMS_MCP_BINDING_SOURCE';
export type McpBindingSource = 'user' | 'explicit' | 'desktop';

export function assertMcpProjectBinding(input: {
  localProjectId?: string;
  boundProjectId: string;
  bindingSource: McpBindingSource;
}): void {
  if (!input.localProjectId || input.bindingSource === 'explicit' || input.bindingSource === 'desktop') return;
  if (input.localProjectId === input.boundProjectId) return;

  throw new Error(
    `AgentTeams MCP project binding mismatch: local project ${input.localProjectId}, bound project ${input.boundProjectId}. ` +
      'No tools were started. Re-register this client with project scope from the current repository, or use an explicit project binding.',
  );
}

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
export async function resolveMcpToolContext(
  options: Record<string, unknown> = {},
  credentialDeps?: ResolveCredentialDeps,
): Promise<McpToolContext> {
  const overrides = buildConfigOverrides(options);
  const config = credentialDeps
    ? await loadConfigWithCredential(overrides, credentialDeps)
    : await loadConfigWithCredential(overrides);
  if (!config) {
    throw new Error(getConfigurationNotFoundMessage());
  }

  assertNoUnresolvedPlaceholders({
    apiKey: config.apiKey,
    projectId: config.projectId,
    teamId: config.teamId,
  });

  const bindingSource: McpBindingSource =
    typeof options.projectId === 'string'
      ? 'explicit'
      : process.env[MCP_BINDING_SOURCE_ENV] === 'desktop'
        ? 'desktop'
        : 'user';
  const localProjectId = loadProjectConfig()?.projectId;
  assertMcpProjectBinding({
    localProjectId: typeof localProjectId === 'string' ? localProjectId : undefined,
    boundProjectId: config.projectId,
    bindingSource,
  });

  const { apiUrl, headers } = resolveApiContext(config);
  // Only a checkout that names this very project may serve local guides.
  const projectRoot = localProjectId === config.projectId ? (findGuideProjectRoot() ?? undefined) : undefined;
  // Same env channel every other CLI command reads. Undefined outside a daemon session.
  const agentConfigId = resolveSessionAgentConfigId();

  const credentialRefreshable = config.credentialRefreshable ?? config.credentialSource === 'personal-token';
  if (!credentialRefreshable) {
    return { apiUrl, projectId: config.projectId, projectRoot, agentConfigId, headers };
  }

  const credential = getActiveCredential();
  return {
    apiUrl,
    projectId: config.projectId,
    projectRoot,
    agentConfigId,
    headers,
    resolveHeaders: async () => {
      const accessToken = await credential?.resolve?.();
      // A refresh that cannot complete right now must not blank the credential:
      // returning the last known headers lets the request fail as a normal 401
      // (which the HTTP layer then retries once) instead of as an unauthenticated
      // call with a confusing error.
      if (!accessToken) return headers;
      return { ...buildAuthHeaders(accessToken), 'Content-Type': 'application/json' };
    },
  };
}
