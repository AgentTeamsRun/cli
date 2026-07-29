import { existsSync, readFileSync } from 'node:fs';
import { PROJECT_SCOPE_FILE_MODE, USER_SCOPE_FILE_MODE, writeConfigFileAtomically } from './atomicWrite.js';
import { findClient, MCP_CLIENTS } from './clients.js';
import { detectClients, type DetectionDependencies } from './detect.js';
import { McpConfigParseError, upsertContainerEntry } from './jsonc.js';
import { buildEntryValue, redactKeyMaterial, renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME, type McpCredentials } from './serverSpec.js';
import type { DetectionSignal, InstallResult, McpClientDefinition, McpPathContext, McpScope } from './types.js';
import { runVendorCommand, type VendorRunner } from './vendorCommand.js';

export interface InstallClientOptions {
  client: McpClientDefinition;
  scope: McpScope;
  credentials: McpCredentials;
  context: McpPathContext;
  serverEntry?: string;
  serverName?: string;
  vendorRunner?: VendorRunner;
}

function firstLines(text: string, limit = 4): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, limit)
    .join(' / ');
}

function installViaVendorCommand(
  options: InstallClientOptions,
  configPath: string,
  manualSnippet: string,
): InstallResult {
  const { client, scope, context } = options;
  const serverName = options.serverName ?? MCP_SERVER_NAME;
  const definition = client.scopes[scope];
  const vendor = definition.vendor;
  if (!vendor) throw new Error(`No vendor command configured for ${client.id}/${scope}`);

  const spec = buildServerSpec({
    serverEntry: options.serverEntry,
    context: options.context,
  });

  const executable = client.executables[0];
  const runner = options.vendorRunner ?? runVendorCommand;
  const outcome = runner(executable, vendor.buildArgs(spec, serverName), { cwd: context.cwd, env: context.env });

  const base = { clientId: client.id, scope, strategy: definition.strategy, configPath } as const;

  if (outcome.spawnError) {
    return {
      ...base,
      outcome: 'FAILED',
      detail: `Could not run \`${executable}\`: ${outcome.spawnError}`,
      manualSnippet,
    };
  }

  // Registration passes no credential, so there is no value of ours to redact — but a
  // vendor CLI echoing its own argv/environment on failure can still surface a `key_`.
  const combined = redactKeyMaterial(`${outcome.stdout}\n${outcome.stderr}`);

  const alreadyRegistered = (vendor.alreadyRegisteredPatterns ?? []).some((pattern) => pattern.test(combined));
  if (alreadyRegistered) {
    return {
      ...base,
      outcome: 'ALREADY_REGISTERED',
      detail: `\`${executable}\` reports "${serverName}" is already registered and refuses to overwrite it. Remove it with the client's own \`mcp remove\` command and re-run, or apply the snippet manually.`,
      manualSnippet,
    };
  }

  if (outcome.status === 0) {
    return {
      ...base,
      outcome: 'INSTALLED',
      detail:
        vendor.rerunBehavior === 'update'
          ? `Registered "${serverName}" via \`${executable} mcp add\` (re-running updates the entry in place).`
          : `Registered "${serverName}" via \`${executable} mcp add\`.`,
    };
  }

  return {
    ...base,
    outcome: 'FAILED',
    detail: `\`${executable} mcp add\` exited with code ${String(outcome.status)}: ${firstLines(combined) || 'no output'}`,
    manualSnippet,
  };
}

function installViaJsonMerge(options: InstallClientOptions, configPath: string, manualSnippet: string): InstallResult {
  const { client, scope } = options;
  const serverName = options.serverName ?? MCP_SERVER_NAME;
  const definition = client.scopes[scope];
  const containerKey = definition.containerKey;
  if (!containerKey) throw new Error(`No container key configured for ${client.id}/${scope}`);

  const base = { clientId: client.id, scope, strategy: definition.strategy, configPath } as const;

  const spec = buildServerSpec({
    serverEntry: options.serverEntry,
    context: options.context,
  });

  let source = '';
  if (existsSync(configPath)) {
    try {
      source = readFileSync(configPath, 'utf-8');
    } catch (error) {
      return {
        ...base,
        outcome: 'FAILED',
        detail: `Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        manualSnippet,
      };
    }
  }

  let edited;
  try {
    edited = upsertContainerEntry(source, {
      containerKey,
      entryKey: serverName,
      entryValue: buildEntryValue(definition.entryShape ?? 'plain', spec),
    });
  } catch (error) {
    const reason = error instanceof McpConfigParseError ? error.message : String(error);
    return {
      ...base,
      outcome: 'FAILED',
      detail: `${configPath} could not be parsed (${reason}). The file was left unchanged — fix it or apply the snippet manually.`,
      manualSnippet,
    };
  }

  if (edited.unchanged) {
    return {
      ...base,
      outcome: 'ALREADY_REGISTERED',
      detail: `"${serverName}" is already present in ${configPath} with identical settings; nothing was written.`,
    };
  }

  try {
    const written = writeConfigFileAtomically(
      configPath,
      edited.text,
      scope === 'user' ? USER_SCOPE_FILE_MODE : PROJECT_SCOPE_FILE_MODE,
      scope === 'user' ? USER_SCOPE_FILE_MODE : undefined,
    );
    return {
      ...base,
      outcome: 'INSTALLED',
      detail: edited.existed
        ? `Updated the "${serverName}" entry in ${configPath}.`
        : `Added "${serverName}" to ${configPath}.`,
      backupPath: written.backupPath ?? undefined,
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAILED',
      detail: `Could not write ${configPath}: ${error instanceof Error ? error.message : String(error)}. The original file was left unchanged.`,
      manualSnippet,
    };
  }
}

/** Apply (or explicitly decline to apply) the AgentTeams entry for one client/scope. */
export function installClient(options: InstallClientOptions): InstallResult {
  const { client, scope } = options;
  const serverName = options.serverName ?? MCP_SERVER_NAME;
  const definition = client.scopes[scope];
  const configPath = definition.configPath(options.context);

  const displaySpec = buildServerSpec({
    serverEntry: options.serverEntry,
    context: options.context,
  });
  const manualSnippet = renderConfigSnippet(client, scope, displaySpec, serverName);

  if (definition.strategy === 'configOnly') {
    return {
      clientId: client.id,
      scope,
      strategy: 'configOnly',
      configPath,
      outcome: 'SKIPPED_CONFIG_ONLY',
      detail: definition.configOnlyReason ?? 'No safe automated write path for this client/scope.',
      manualSnippet,
    };
  }

  if (definition.strategy === 'vendorCommand') {
    return installViaVendorCommand(options, configPath, manualSnippet);
  }

  return installViaJsonMerge(options, configPath, manualSnippet);
}

export interface BatchPlanEntry {
  clientId: McpClientDefinition['id'];
  label: string;
  evidence: DetectionSignal['evidence'];
  executablePath: string | null;
  configPaths: string[];
  scope: McpScope;
  strategy: McpClientDefinition['scopes'][McpScope]['strategy'];
  targetPath: string;
  applicable: boolean;
  reason?: string;
}

export interface BatchPlan {
  scope: McpScope;
  entries: BatchPlanEntry[];
  /** A single user-scope registration binds the client to one AgentTeams project. */
  binding: { projectId: string; teamId: string };
}

export interface BuildBatchPlanOptions {
  context: McpPathContext;
  credentials: McpCredentials;
  scope?: McpScope;
  detection?: DetectionSignal[];
  detectionDependencies?: Omit<DetectionDependencies, 'context'>;
}

/**
 * Detection plan for the no-argument `install`. Nothing here touches the
 * filesystem — the caller prints it and stops unless `--yes` was passed.
 */
export function buildBatchPlan(options: BuildBatchPlanOptions): BatchPlan {
  const scope = options.scope ?? 'user';
  const detection =
    options.detection ?? detectClients({ context: options.context, ...(options.detectionDependencies ?? {}) });

  const entries = MCP_CLIENTS.map((client) => {
    const signal = detection.find((candidate) => candidate.clientId === client.id);
    const definition = client.scopes[scope];
    const detected = signal?.detected ?? false;
    const applicable = detected && definition.strategy !== 'configOnly';

    let reason: string | undefined;
    if (!detected) reason = 'Not detected on this machine.';
    else if (definition.strategy === 'configOnly') reason = definition.configOnlyReason;

    return {
      clientId: client.id,
      label: client.label,
      evidence: signal?.evidence ?? 'none',
      executablePath: signal?.executablePath ?? null,
      configPaths: signal?.configPaths ?? [],
      scope,
      strategy: definition.strategy,
      targetPath: definition.configPath(options.context),
      applicable,
      reason,
    };
  });

  return {
    scope,
    entries,
    binding: { projectId: options.credentials.projectId, teamId: options.credentials.teamId },
  };
}

export interface RunBatchInstallOptions extends BuildBatchPlanOptions {
  serverEntry?: string;
  serverName?: string;
  vendorRunner?: VendorRunner;
}

/**
 * Apply the plan client by client. One client's failure must not strand the
 * rest, so every entry is attempted and the caller derives the exit code from
 * the collected outcomes.
 */
export function runBatchInstall(options: RunBatchInstallOptions): { plan: BatchPlan; results: InstallResult[] } {
  const scope = options.scope ?? 'user';
  const plan = buildBatchPlan({ ...options, scope });
  const results: InstallResult[] = [];

  for (const entry of plan.entries) {
    const client = findClient(entry.clientId);
    if (!client) continue;

    if (!entry.applicable) {
      results.push({
        clientId: entry.clientId,
        scope: entry.scope,
        strategy: entry.strategy,
        configPath: entry.targetPath,
        outcome: entry.strategy === 'configOnly' ? 'SKIPPED_CONFIG_ONLY' : 'SKIPPED_NOT_DETECTED',
        detail: entry.reason ?? 'Skipped.',
      });
      continue;
    }

    results.push(
      installClient({
        client,
        scope: entry.scope,
        credentials: options.credentials,
        context: options.context,
        serverEntry: options.serverEntry,
        serverName: options.serverName,
        vendorRunner: options.vendorRunner,
      }),
    );
  }

  return { plan, results };
}

/** Non-zero exit only for real failures; "config only" and "not detected" are expected states. */
export function resolveInstallExitCode(results: InstallResult[]): number {
  return results.some((result) => result.outcome === 'FAILED') ? 1 : 0;
}

export { renderConfigSnippet, renderVendorCommandLine };
