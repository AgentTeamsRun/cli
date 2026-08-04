import { homedir } from 'node:os';
import { getConfigurationNotFoundMessage, loadConfigIdentity } from '../utils/config.js';
import { buildConfigOverrides } from '../utils/apiContext.js';
import { parseToolProfile } from '../mcp/toolProfile.js';
import { findClient, listClientIds } from './clients.js';
import type { DetectionDependencies } from './detect.js';
import { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall, type BatchPlan } from './install.js';
import { renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME, type McpCredentials } from './serverSpec.js';
import type {
  InstallResult,
  McpClientDefinition,
  McpClientId,
  McpPathContext,
  McpScope,
  McpServerSpec,
} from './types.js';
import type { VendorRunner } from './vendorCommand.js';

export { MCP_CLIENTS, findClient, listClientIds } from './clients.js';
export { detectClients } from './detect.js';
export { runMcpDoctorCommand } from './doctor.js';
export type {
  McpDoctorCleanup,
  McpDoctorCommandOptions,
  McpDoctorCommandOutput,
  McpDoctorDependencies,
  McpDoctorFinding,
  McpDoctorReport,
} from './doctor.js';
export { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall } from './install.js';
export { renderConfigSnippet, renderVendorCommandLine, redactKeyMaterial } from './render.js';
export { buildServerSpec, MCP_SERVER_NAME } from './serverSpec.js';
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
  toolProfile?: string;
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

/**
 * What goes into a client's config file.
 *
 * Registration uses identity only for command context and human-readable
 * output. The generated server spec never receives these values:
 * `agentteams mcp` resolves project identity and credentials at request time.
 */
function resolveCredentials(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): McpCredentials {
  if (dependencies?.credentials) return dependencies.credentials;

  const overrides = buildConfigOverrides(options as Record<string, unknown>);
  const identity = loadConfigIdentity(overrides);
  if (!identity) throw new Error(getConfigurationNotFoundMessage());

  // Identity only. Asking for a credential plan here would be dead work — the spec
  // embeds nothing — and it would attach a side effect (the legacy `key_` warning)
  // to `mcp config`, which renders a snippet and touches no file.
  return {
    projectId: identity.projectId,
    teamId: identity.teamId,
    apiUrl: identity.apiUrl,
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

/**
 * Say which runtime the entry will spawn, so the choice is never silent.
 *
 * The bare executable is the fast path; `npx` is what a machine without a global install
 * gets. Either way the user sees the reason here instead of discovering it as a client-side
 * "server failed to start" (or as an unexplained cold start on every request).
 */
function describeRuntime(spec: McpServerSpec): string {
  return spec.command === 'npx'
    ? 'No global `agentteams` was found on PATH, so the entry runs the published package with npx. Run `npm install -g @agentteams/cli` and re-register for a faster start.'
    : 'The entry runs the globally installed `agentteams` executable.';
}

function describeNativeDiscovery(client: McpClientDefinition, toolProfile: string): string {
  const capability = client.nativeDiscovery;
  const version = capability.version ? ` (${capability.version})` : '';
  const evidence = capability.evidenceUrl ? ` Evidence: ${capability.evidenceUrl}` : '';

  if (capability.status === 'verified') {
    return `Native tool discovery: verified${version}. The full profile preserves the complete catalog while the client loads definitions on demand.${evidence}`;
  }

  const recommendation =
    toolProfile === 'full'
      ? 'If upfront schema cost matters, re-run with --tool-profile read, documents, comments, or minimal.'
      : `The explicit ${toolProfile} profile limits the catalog exposed to this client.`;
  return `Native tool discovery: ${capability.status}${version}. ${capability.reason ?? ''} ${recommendation}${evidence}`.replace(
    /\s+/g,
    ' ',
  );
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
 * expects and never touches a file, a vendor CLI or the network. The spawned
 * server resolves local project identity and credentials for itself, so the
 * fragment is safe to paste without any environment values.
 */
export function runMcpConfigCommand(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): CommandOutput {
  const credentials = resolveCredentials(options, dependencies);
  const context = resolvePathContext(dependencies?.context);
  const scope = parseScope(options.scope);
  const toolProfile = parseToolProfile(options.toolProfile);
  const clientIds = options.client ? [parseClientId(options.client)] : MCP_CLIENT_ID_LIST;

  const spec = buildServerSpec({ serverEntry: options.serverEntry, context, toolProfile });

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
      nativeDiscovery: client.nativeDiscovery,
      profileGuidance: describeNativeDiscovery(client, toolProfile),
      toolProfile,
      server: spec,
      snippet: renderConfigSnippet(client, scope, spec, MCP_SERVER_NAME),
      vendorCommand: renderVendorCommandLine(client, scope, spec, MCP_SERVER_NAME),
      configOnlyReason: definition.configOnlyReason ?? null,
    };
  });

  const lines: string[] = [
    `AgentTeams MCP config (${scope} scope) — project ${credentials.projectId}, team ${credentials.teamId}`,
    'No credentials or project binding are embedded. The MCP server resolves local configuration and the OS credential store at request time.',
    `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
    describeRuntime(spec),
  ];

  for (const section of sections) {
    lines.push('');
    lines.push(`## ${section.label} (${section.clientId})`);
    lines.push(`File: ${section.configPath}`);
    if (section.configOnlyReason) lines.push(`Note: ${section.configOnlyReason}`);
    if (section.vendorCommand) lines.push(`Command: ${section.vendorCommand}`);
    lines.push(section.snippet);
    lines.push(section.profileGuidance);
    lines.push(`Docs: ${section.docsUrl} (verified ${section.verifiedAt})`);
  }

  return { text: lines.join('\n'), json: { scope, toolProfile, server: spec, clients: sections }, exitCode: 0 };
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
  const toolProfile = parseToolProfile(options.toolProfile);
  const spec = buildServerSpec({ serverEntry: options.serverEntry, context, toolProfile });

  if (options.client) {
    const client = findClient(parseClientId(options.client));
    if (!client) throw new Error(`Unknown client: ${options.client}`);

    const result = installClient({
      client,
      scope,
      credentials,
      context,
      serverEntry: options.serverEntry,
      toolProfile,
      vendorRunner: dependencies?.vendorRunner,
    });

    const lines = [
      `AgentTeams MCP install — ${client.label} (${scope} scope)`,
      `Project ${credentials.projectId}, team ${credentials.teamId}`,
      'The server entry contains no credentials or project binding; runtime resolution uses local configuration and the OS credential store.',
      `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
      describeRuntime(spec),
    ];
    lines.push(renderResultLine(result));
    if (result.backupPath) lines.push(`Backup: ${result.backupPath}`);
    if (result.manualSnippet) {
      lines.push('Manual fallback:');
      lines.push(result.manualSnippet);
    }

    return {
      text: lines.join('\n'),
      json: { scope, toolProfile, server: spec, results: [result], summary: summarize([result]) },
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
      'The server entries contain no credentials or project binding; runtime resolution uses local configuration and the OS credential store.',
      `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
      describeRuntime(spec),
      '',
    ];

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

    return { text: lines.join('\n'), json: { scope, toolProfile, server: spec, dryRun: true, plan }, exitCode: 0 };
  }

  const { plan, results } = runBatchInstall({
    context,
    credentials,
    scope,
    serverEntry: options.serverEntry,
    toolProfile,
    vendorRunner: dependencies?.vendorRunner,
    detectionDependencies: dependencies?.detectionDependencies,
  });

  const summary = summarize(results);
  const lines = [
    `AgentTeams MCP install — applied at ${scope} scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
    `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
    describeRuntime(spec),
    ...results.map(renderResultLine),
    '',
    `Summary: ${summary.applied} registered, ${summary.skipped} skipped, ${summary.failed} failed.`,
  ];

  return {
    text: lines.join('\n'),
    json: { scope, toolProfile, server: spec, dryRun: false, plan, results, summary },
    exitCode: resolveInstallExitCode(results),
  };
}
