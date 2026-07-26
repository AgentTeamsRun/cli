import { homedir } from 'node:os';
import { getConfigurationNotFoundMessage, loadConfig } from '../utils/config.js';
import { buildConfigOverrides } from '../utils/apiContext.js';
import { findClient, listClientIds, MCP_CLIENTS } from './clients.js';
import type { DetectionDependencies } from './detect.js';
import { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall, type BatchPlan } from './install.js';
import { renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME, type McpCredentials } from './serverSpec.js';
import type { InstallResult, McpClientId, McpPathContext, McpScope } from './types.js';
import type { VendorRunner } from './vendorCommand.js';

export { MCP_CLIENTS, findClient, listClientIds } from './clients.js';
export { detectClients } from './detect.js';
export { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall } from './install.js';
export { renderConfigSnippet, renderVendorCommandLine, redactSecrets } from './render.js';
export { buildServerSpec, MCP_SERVER_NAME, CREDENTIAL_ENV_KEYS } from './serverSpec.js';
export type { McpCredentials } from './serverSpec.js';
export * from './types.js';

const MCP_CLIENT_ID_LIST = listClientIds();

export { MCP_CLIENT_ID_LIST };

export interface McpRegistrationCommandOptions {
  client?: string;
  scope?: string;
  serverEntry?: string;
  yes?: boolean;
  apiKey?: string;
  apiUrl?: string;
  projectId?: string;
  teamId?: string;
}

/** Injection seams so tests drive a temporary HOME/cwd and a fake vendor CLI. */
export interface McpRegistrationDependencies {
  context?: Partial<McpPathContext>;
  credentials?: McpCredentials;
  vendorRunner?: VendorRunner;
  detectionDependencies?: Omit<DetectionDependencies, 'context'>;
}

export interface CommandOutput {
  text: string;
  json: unknown;
  exitCode: number;
}

function resolveCredentials(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): McpCredentials {
  if (dependencies?.credentials) return dependencies.credentials;

  const config = loadConfig(buildConfigOverrides(options as Record<string, unknown>));
  if (!config) throw new Error(getConfigurationNotFoundMessage());
  return {
    apiKey: config.apiKey,
    projectId: config.projectId,
    teamId: config.teamId,
    apiUrl: config.apiUrl,
  };
}

function resolvePathContext(overrides?: Partial<McpPathContext>): McpPathContext {
  return {
    homeDir: overrides?.homeDir ?? homedir(),
    cwd: overrides?.cwd ?? process.cwd(),
    env: overrides?.env ?? process.env,
  };
}

function parseScope(value: unknown): McpScope {
  if (value === undefined || value === null || value === '') return 'project';
  if (value === 'user' || value === 'project') return value;
  throw new Error(`Unsupported scope: ${String(value)}. Use "user" or "project".`);
}

function parseClientId(value: string): McpClientId {
  const client = findClient(value);
  if (!client) {
    throw new Error(`Unknown client: ${value}. Supported clients: ${MCP_CLIENT_ID_LIST.join(', ')}.`);
  }
  return client.id;
}

/**
 * `config` is the escape hatch: it renders the exact fragment each client
 * expects and never touches a file, a vendor CLI or the network. The API key is
 * always emitted with the target client's environment-reference contract so
 * the output stays safe to paste into a terminal, an issue or a code review.
 */
export function runMcpConfigCommand(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): CommandOutput {
  const credentials = resolveCredentials(options, dependencies);
  const context = resolvePathContext(dependencies?.context);
  const scope = parseScope(options.scope);
  const clientIds = options.client ? [parseClientId(options.client)] : MCP_CLIENT_ID_LIST;

  const spec = buildServerSpec({ credentials, secretMode: 'reference', serverEntry: options.serverEntry });

  const sections = clientIds.map((clientId) => {
    const client = findClient(clientId);
    if (!client) throw new Error(`Unknown client: ${clientId}`);
    const definition = client.scopes[scope];
    return {
      clientId,
      label: client.label,
      scope,
      configPath: definition.configPath(context),
      format: definition.format,
      strategy: definition.strategy,
      docsUrl: client.docsUrl,
      verifiedAt: client.verifiedAt,
      snippet: renderConfigSnippet(client, scope, spec, MCP_SERVER_NAME),
      vendorCommand: renderVendorCommandLine(client, scope, spec, MCP_SERVER_NAME),
      configOnlyReason: definition.configOnlyReason ?? null,
    };
  });

  const lines: string[] = [
    `AgentTeams MCP config (${scope} scope) — project ${credentials.projectId}, team ${credentials.teamId}`,
    'The API key is rendered with the selected client’s environment-reference syntax. Export AGENTTEAMS_API_KEY before the client starts.',
  ];

  for (const section of sections) {
    lines.push('');
    lines.push(`## ${section.label} (${section.clientId})`);
    lines.push(`File: ${section.configPath}`);
    if (section.configOnlyReason) lines.push(`Note: ${section.configOnlyReason}`);
    if (section.vendorCommand) lines.push(`Command: ${section.vendorCommand}`);
    lines.push(section.snippet);
    lines.push(`Docs: ${section.docsUrl} (verified ${section.verifiedAt})`);
  }

  return { text: lines.join('\n'), json: { scope, clients: sections }, exitCode: 0 };
}

function formatDetectionEvidence(entry: BatchPlan['entries'][number]): string {
  if (entry.evidence === 'none') return 'not detected';
  const parts: string[] = [];
  if (entry.executablePath) parts.push(`executable ${entry.executablePath}`);
  if (entry.configPaths.length > 0) parts.push(`config ${entry.configPaths[0]}`);
  return `${entry.evidence} (${parts.join(', ')})`;
}

function renderResultLine(result: InstallResult): string {
  return `- ${result.clientId} [${result.outcome}] ${result.detail}`;
}

function summarize(results: InstallResult[]): { applied: number; skipped: number; failed: number } {
  return {
    applied: results.filter((r) => r.outcome === 'INSTALLED' || r.outcome === 'ALREADY_REGISTERED').length,
    skipped: results.filter((r) => r.outcome === 'SKIPPED_CONFIG_ONLY' || r.outcome === 'SKIPPED_NOT_DETECTED').length,
    failed: results.filter((r) => r.outcome === 'FAILED').length,
  };
}

const USER_SCOPE_BINDING_WARNING =
  'Warning: a user-scope registration is machine-wide. If this client already has an "agentteams" server pointing at a different AgentTeams project, applying this plan re-points it.';

/**
 * `install` has two modes:
 *  - `--client <id>`: apply a single client/scope (project scope allowed here).
 *  - no `--client`: detect local clients and print the plan. Only `--yes` turns
 *    that plan into writes, and only at user scope.
 */
export function runMcpInstallCommand(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): CommandOutput {
  const credentials = resolveCredentials(options, dependencies);
  const context = resolvePathContext(dependencies?.context);
  const scope = parseScope(options.scope);

  if (options.client) {
    const client = findClient(parseClientId(options.client));
    if (!client) throw new Error(`Unknown client: ${options.client}`);

    const result = installClient({
      client,
      scope,
      credentials,
      context,
      serverEntry: options.serverEntry,
      vendorRunner: dependencies?.vendorRunner,
    });

    const lines = [
      `AgentTeams MCP install — ${client.label} (${scope} scope)`,
      `Project ${credentials.projectId}, team ${credentials.teamId}`,
    ];
    if (scope === 'user') lines.push(USER_SCOPE_BINDING_WARNING);
    lines.push(renderResultLine(result));
    if (result.backupPath) lines.push(`Backup: ${result.backupPath}`);
    if (result.manualSnippet) {
      lines.push('Manual fallback:');
      lines.push(result.manualSnippet);
    }

    return {
      text: lines.join('\n'),
      json: { scope, results: [result], summary: summarize([result]) },
      exitCode: resolveInstallExitCode([result]),
    };
  }

  if (scope === 'project' && options.yes) {
    throw new Error(
      'Batch install does not support --scope project: project files are repository state and must be chosen per client. Re-run with --client <id> --scope project.',
    );
  }

  if (!options.yes) {
    const plan = buildBatchPlan({
      context,
      credentials,
      scope,
      detectionDependencies: dependencies?.detectionDependencies,
    });

    const lines = [
      'AgentTeams MCP install — dry run (no files were changed)',
      `Plan: register "${MCP_SERVER_NAME}" at ${scope} scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
      '',
    ];
    if (scope === 'user') lines.splice(2, 0, USER_SCOPE_BINDING_WARNING);

    for (const entry of plan.entries) {
      lines.push(`- ${entry.clientId} [${entry.applicable ? 'will apply' : 'skip'}] ${formatDetectionEvidence(entry)}`);
      lines.push(`    target: ${entry.targetPath} via ${entry.strategy}`);
      if (entry.reason) lines.push(`    reason: ${entry.reason}`);
    }

    lines.push('');
    lines.push(
      scope === 'user'
        ? 'Re-run with --yes to apply, or use `agentteams mcp config --client <id> --scope user` for a manual snippet.'
        : 'Choose one client and run `agentteams mcp install --client <id> --scope project`, or use `agentteams mcp config --client <id> --scope project` for a manual snippet.',
    );

    return { text: lines.join('\n'), json: { scope, dryRun: true, plan }, exitCode: 0 };
  }

  const { plan, results } = runBatchInstall({
    context,
    credentials,
    serverEntry: options.serverEntry,
    vendorRunner: dependencies?.vendorRunner,
    detectionDependencies: dependencies?.detectionDependencies,
  });

  const summary = summarize(results);
  const lines = [
    `AgentTeams MCP install — applied at user scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
    ...results.map(renderResultLine),
    '',
    `Summary: ${summary.applied} registered, ${summary.skipped} skipped, ${summary.failed} failed.`,
  ];

  return {
    text: lines.join('\n'),
    json: { scope: 'user', dryRun: false, plan, results, summary },
    exitCode: resolveInstallExitCode(results),
  };
}
