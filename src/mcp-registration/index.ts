import { homedir } from 'node:os';
import { getConfigurationNotFoundMessage, loadConfigIdentity } from '../utils/config.js';
import { buildConfigOverrides } from '../utils/apiContext.js';
import { parseToolProfile } from '../mcp/toolProfile.js';
import { findClient, listClientIds } from './clients.js';
import { detectClients, type DetectionDependencies } from './detect.js';
import { buildBatchPlan, installClient, resolveInstallExitCode, runBatchInstall, type BatchPlan } from './install.js';
import { renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME, type McpCredentials } from './serverSpec.js';
import { isExplicitToolProfile, resolveClientToolProfile } from './toolProfileSupport.js';
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
export { isExplicitToolProfile, resolveClientToolProfile } from './toolProfileSupport.js';
export type { ResolvedClientToolProfile } from './toolProfileSupport.js';
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
  /** Preview only: build the detection plan and touch nothing. */
  dryRun?: boolean;
  yes?: boolean;
  /**
   * Machine-readable output. A programmatic caller cannot see or answer a prompt, so
   * this also keeps the batch install behind an explicit `--yes` (see
   * `runMcpInstallCommand`).
   */
  json?: boolean;
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
 *
 * The two npx cases read differently and must not share one sentence: at project scope it
 * is a deliberate choice about a file that gets committed, not a report that this machine
 * is missing something.
 */
function describeRuntime(spec: McpServerSpec, scope: McpScope): string {
  if (spec.command !== 'npx') return 'The entry runs the globally installed `agentteams` executable.';
  if (scope === 'project') {
    return 'Project files are shared with everyone who clones this repository, so the entry runs the published package with npx rather than whichever runtime this machine happens to have. Use `--scope user` for a per-machine entry that starts faster.';
  }
  return 'No global `agentteams` was found on PATH, so the entry runs the published package with npx. Run `npm install -g @agentteams/cli` and re-register for a faster start.';
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
  const explicitToolProfile = isExplicitToolProfile(options.toolProfile);
  const clientIds = options.client ? [parseClientId(options.client)] : MCP_CLIENT_ID_LIST;

  const spec = buildServerSpec({ serverEntry: options.serverEntry, context, toolProfile, scope });

  const sections = clientIds.map((clientId) => {
    const client = findClient(clientId);
    if (!client) throw new Error(`Unknown client: ${clientId}`);
    const definition = client.scopes[scope];
    // A client whose backend rejects part of the catalog gets its own profile — and
    // therefore its own spec — so the printed snippet is the one it can actually load.
    const resolved = resolveClientToolProfile(client, toolProfile, explicitToolProfile);
    const clientSpec =
      resolved.toolProfile === toolProfile
        ? spec
        : buildServerSpec({ serverEntry: options.serverEntry, context, toolProfile: resolved.toolProfile, scope });
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
      profileGuidance: describeNativeDiscovery(client, resolved.toolProfile),
      toolProfile: resolved.toolProfile,
      toolProfileNotice: resolved.notice ?? null,
      server: clientSpec,
      snippet: renderConfigSnippet(client, scope, clientSpec, MCP_SERVER_NAME),
      vendorCommand: renderVendorCommandLine(client, scope, clientSpec, MCP_SERVER_NAME),
      configOnlyReason: definition.configOnlyReason ?? null,
    };
  });

  const lines: string[] = [
    `AgentTeams MCP config (${scope} scope) — project ${credentials.projectId}, team ${credentials.teamId}`,
    'No credentials or project binding are embedded. The MCP server resolves local configuration and the stored login (OS credential store, or a permission-protected file when that store is unavailable) at request time.',
    `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
    describeRuntime(spec, scope),
  ];

  for (const section of sections) {
    lines.push('');
    lines.push(`## ${section.label} (${section.clientId})`);
    lines.push(`File: ${section.configPath}`);
    if (section.configOnlyReason) lines.push(`Note: ${section.configOnlyReason}`);
    if (section.vendorCommand) lines.push(`Command: ${section.vendorCommand}`);
    if (section.toolProfileNotice) lines.push(section.toolProfileNotice);
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
  const line = `- ${result.clientId} [${result.outcome}] ${result.detail}`;
  return result.toolProfileNotice ? `${line}\n    ${result.toolProfileNotice}` : line;
}

function summarize(results: InstallResult[]): { applied: number; skipped: number; failed: number } {
  return {
    applied: results.filter((r) => r.outcome === 'INSTALLED' || r.outcome === 'ALREADY_REGISTERED').length,
    skipped: results.filter((r) => r.outcome.startsWith('SKIPPED_')).length,
    failed: results.filter((r) => r.outcome === 'FAILED').length,
  };
}

export interface McpBatchInstallResult {
  scope: McpScope;
  plan: BatchPlan;
  results: InstallResult[];
  summary: { applied: number; skipped: number; failed: number };
  exitCode: number;
}

/**
 * What the batch path actually reads.
 *
 * `client`, `dryRun`, `yes` and `json` are deliberately absent: they select *whether*
 * the batch runs, and `runMcpInstallCommand` resolves them before it gets here.
 * Accepting them would let a caller pass `dryRun: true` and still have files written.
 */
export type McpBatchInstallOptions = Omit<McpRegistrationCommandOptions, 'client' | 'dryRun' | 'yes' | 'json'>;

/**
 * Detect the local clients and register AgentTeams with every one this scope can
 * apply automatically. This always applies — there is no preview mode here.
 *
 * Exported so `agentteams init --mcp` reuses the exact command path instead of
 * re-deriving detection and strategy rules on its own.
 */
export function applyMcpBatchInstall(
  options: McpBatchInstallOptions,
  dependencies?: McpRegistrationDependencies,
): McpBatchInstallResult {
  const credentials = resolveCredentials(options, dependencies);
  const context = resolvePathContext(dependencies?.context);
  const scope = parseScope(options.scope);
  const toolProfile = parseToolProfile(options.toolProfile);
  const explicitToolProfile = isExplicitToolProfile(options.toolProfile);

  const { plan, results } = runBatchInstall({
    context,
    credentials,
    scope,
    serverEntry: options.serverEntry,
    toolProfile,
    explicitToolProfile,
    vendorRunner: dependencies?.vendorRunner,
    detectionDependencies: dependencies?.detectionDependencies,
  });

  return { scope, plan, results, summary: summarize(results), exitCode: resolveInstallExitCode(results) };
}

/**
 * `install` applies what it detects:
 *  - `--client <id>`: apply that one client at the selected scope.
 *  - no `--client`, project scope (the default): apply every detected client whose
 *    project scope has a safe automated path. Project files are repository state the
 *    caller already owns, so no extra approval is asked for.
 *  - no `--client`, `--scope user`: machine-wide client configs, so the plan is only
 *    printed until `--yes` approves it.
 *  - no `--client`, `--json`: the plan is printed until `--yes` approves it, whatever
 *    the scope. JSON output means another program is driving this, and the desktop
 *    app has shipped versions that call the project-scope argv expecting a preview.
 *  - `--dry-run`: preview at any scope. No file is written and no registration command
 *    is run; detection may still run a client's own `--help` to confirm its identity.
 */
export function runMcpInstallCommand(
  options: McpRegistrationCommandOptions,
  dependencies?: McpRegistrationDependencies,
): CommandOutput {
  const credentials = resolveCredentials(options, dependencies);
  const context = resolvePathContext(dependencies?.context);
  const scope = parseScope(options.scope);
  const toolProfile = parseToolProfile(options.toolProfile);
  const explicitToolProfile = isExplicitToolProfile(options.toolProfile);
  const spec = buildServerSpec({ serverEntry: options.serverEntry, context, toolProfile, scope });

  // Checked before anything reads a config or spawns a vendor CLI: the two flags state
  // opposite intents, and guessing which one wins would either skip an approval or
  // write during a preview.
  if (options.dryRun && options.yes) {
    throw new Error(
      '--dry-run cannot be combined with --yes: one previews the plan and the other applies it. Re-run with only one of them.',
    );
  }

  if (options.dryRun) {
    // No file is written and no registration command runs here. Detection itself may
    // still spawn a client's own `--help` to confirm the executable's identity — that
    // is a read, but it is not "nothing runs".
    //
    // Validated here too so an unknown `--client` still fails before the preview,
    // exactly as it does on the apply path.
    const clientId = options.client ? parseClientId(options.client) : null;
    const fullPlan = buildBatchPlan({
      context,
      credentials,
      scope,
      detectionDependencies: dependencies?.detectionDependencies,
    });
    const plan: BatchPlan = clientId
      ? { ...fullPlan, entries: fullPlan.entries.filter((entry) => entry.clientId === clientId) }
      : fullPlan;

    const lines = [
      'AgentTeams MCP install — dry run (no files were changed)',
      `Plan: register "${MCP_SERVER_NAME}" at ${scope} scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
      'The server entries contain no credentials or project binding; runtime resolution uses local configuration and the stored login.',
      `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
      describeRuntime(spec, scope),
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
        ? 'Re-run with --scope user --yes to apply, or use `agentteams mcp config --scope user` for manual snippets.'
        : 'Re-run without --dry-run to apply, or use `agentteams mcp config` for manual snippets.',
    );

    return { text: lines.join('\n'), json: { scope, toolProfile, server: spec, dryRun: true, plan }, exitCode: 0 };
  }

  if (options.client) {
    const client = findClient(parseClientId(options.client));
    if (!client) throw new Error(`Unknown client: ${options.client}`);

    const detection = detectClients({ context, ...(dependencies?.detectionDependencies ?? {}) });
    const executablePath = detection.find((signal) => signal.clientId === client.id)?.executablePath ?? null;
    const result = installClient({
      client,
      scope,
      credentials,
      context,
      serverEntry: options.serverEntry,
      toolProfile,
      explicitToolProfile,
      vendorRunner: dependencies?.vendorRunner,
      executablePath,
    });

    const lines = [
      `AgentTeams MCP install — ${client.label} (${scope} scope)`,
      `Project ${credentials.projectId}, team ${credentials.teamId}`,
      'The server entry contains no credentials or project binding; runtime resolution uses local configuration and the stored login.',
      `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
      describeRuntime(spec, scope),
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

  // Two batch runs still stop at a preview until `--yes` approves them:
  //  - `--scope user`, because it writes machine-wide client configs.
  //  - `--json`, because that output exists for another program. `agentteams mcp
  //    install --scope project --json` is the argv the desktop app's MCP panel has
  //    always used as its detection-plan call, and CLI and desktop ship
  //    independently, so changing what it does would make an already-installed
  //    desktop write files nobody asked for. A machine caller that does want the
  //    apply says so with `--yes`.
  // Interactive project scope needs no such gate: those files are repository state
  // the person running the command already owns.
  const batchNeedsApproval = scope === 'user' || options.json === true;
  if (batchNeedsApproval && !options.yes) {
    const plan = buildBatchPlan({
      context,
      credentials,
      scope,
      detectionDependencies: dependencies?.detectionDependencies,
    });

    const lines = [
      'AgentTeams MCP install — preview (no files were changed)',
      `Plan: register "${MCP_SERVER_NAME}" at ${scope} scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
      'The server entries contain no credentials or project binding; runtime resolution uses local configuration and the stored login.',
      `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
      describeRuntime(spec, scope),
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
        ? "User scope edits this machine's global client configuration. Re-run with --scope user --yes to apply, or use `agentteams mcp config --scope user` for manual snippets."
        : '--json prints the plan only. Re-run with --yes to apply, or drop --json to apply from an interactive run.',
    );

    return { text: lines.join('\n'), json: { scope, toolProfile, server: spec, dryRun: true, plan }, exitCode: 0 };
  }

  const { plan, results, summary } = applyMcpBatchInstall(options, dependencies);

  const lines = [
    `AgentTeams MCP install — applied at ${scope} scope for project ${plan.binding.projectId}, team ${plan.binding.teamId}`,
    `Tool profile: ${toolProfile}${toolProfile === 'full' ? ' (default; all tools)' : ' (explicit limited catalog)'}.`,
    describeRuntime(spec, scope),
    ...results.map(renderResultLine),
    '',
    `Summary: ${summary.applied} registered, ${summary.skipped} skipped, ${summary.failed} failed.`,
  ];

  // A client this scope cannot write to — Codex project config, or one whose vendor CLI
  // refused — is not a failure, but leaving the user with only the reason would strand
  // them. The snippet each of those results carries is printed so the registration can
  // still be finished by hand.
  const manualFallbacks = results.filter((result) => result.manualSnippet);
  if (manualFallbacks.length > 0) {
    lines.push('');
    lines.push('Manual configuration is still needed for:');
    for (const result of manualFallbacks) {
      lines.push('');
      lines.push(`## ${result.clientId} — ${result.configPath}`);
      lines.push(result.manualSnippet as string);
    }
  }

  return {
    text: lines.join('\n'),
    json: { scope, toolProfile, server: spec, dryRun: false, plan, results, summary },
    exitCode: resolveInstallExitCode(results),
  };
}
