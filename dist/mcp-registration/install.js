import { existsSync, readFileSync } from 'node:fs';
import { PROJECT_SCOPE_FILE_MODE, USER_SCOPE_FILE_MODE, writeConfigFileAtomically } from './atomicWrite.js';
import { findClient, MCP_CLIENTS } from './clients.js';
import { detectClients } from './detect.js';
import { ensureRootMember, McpConfigParseError, upsertContainerEntry } from './jsonc.js';
import { buildEntryValue, redactKeyMaterial, renderConfigSnippet, renderVendorCommandLine } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME } from './serverSpec.js';
import { resolveClientToolProfile } from './toolProfileSupport.js';
import { runVendorCommand } from './vendorCommand.js';
function firstLines(text, limit = 4) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, limit)
        .join(' / ');
}
function installViaVendorCommand(options, configPath, manualSnippet) {
    const { client, scope, context } = options;
    const serverName = options.serverName ?? MCP_SERVER_NAME;
    const definition = client.scopes[scope];
    const vendor = definition.vendor;
    if (!vendor)
        throw new Error(`No vendor command configured for ${client.id}/${scope}`);
    const spec = buildServerSpec({
        serverEntry: options.serverEntry,
        context: options.context,
        toolProfile: options.toolProfile,
        scope,
    });
    const executable = options.executablePath ?? client.executables[0];
    const runner = options.vendorRunner ?? runVendorCommand;
    const identity = client.executableIdentity;
    if (identity) {
        const identityOutcome = runner(executable, identity.args, { cwd: context.cwd, env: context.env });
        const identityOutput = `${identityOutcome.stdout}\n${identityOutcome.stderr}`;
        if (identityOutcome.spawnError || identityOutcome.status !== 0 || !identityOutput.includes(identity.marker)) {
            return {
                clientId: client.id,
                scope,
                strategy: definition.strategy,
                configPath,
                outcome: 'FAILED',
                detail: `Refused to run \`${executable}\`: it did not identify itself as ${client.label}.`,
                manualSnippet,
            };
        }
    }
    const outcome = runner(executable, vendor.buildArgs(spec, serverName), { cwd: context.cwd, env: context.env });
    const base = { clientId: client.id, scope, strategy: definition.strategy, configPath };
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
            detail: vendor.rerunBehavior === 'update'
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
function installViaJsonMerge(options, configPath, manualSnippet) {
    const { client, scope } = options;
    const serverName = options.serverName ?? MCP_SERVER_NAME;
    const definition = client.scopes[scope];
    const containerKey = definition.containerKey;
    if (!containerKey)
        throw new Error(`No container key configured for ${client.id}/${scope}`);
    const base = { clientId: client.id, scope, strategy: definition.strategy, configPath };
    const spec = buildServerSpec({
        serverEntry: options.serverEntry,
        context: options.context,
        toolProfile: options.toolProfile,
        scope,
    });
    let source = '';
    if (existsSync(configPath)) {
        try {
            source = readFileSync(configPath, 'utf-8');
        }
        catch (error) {
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
        // Native settings (Muse `schema_version`) get their marker injected when it is missing —
        // including a zero-byte file — and are only refused when the file already declares a
        // different value, which means a schema this CLI does not know how to write.
        for (const [key, value] of Object.entries(definition.requiredRootValues ?? {})) {
            const ensured = ensureRootMember(source, key, value);
            if (ensured.existed && ensured.existing !== value) {
                return {
                    ...base,
                    outcome: 'FAILED',
                    detail: `${configPath} declares "${key}": ${JSON.stringify(ensured.existing)}, but this version of AgentTeams only knows how to write "${key}": ${JSON.stringify(value)}. The file was left unchanged — update AgentTeams or apply the snippet manually.`,
                    manualSnippet,
                };
            }
            source = ensured.text;
        }
        edited = upsertContainerEntry(source, {
            containerKey,
            entryKey: serverName,
            entryValue: buildEntryValue(definition.entryShape ?? 'plain', spec),
        });
    }
    catch (error) {
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
        const written = writeConfigFileAtomically(configPath, edited.text, scope === 'user' ? USER_SCOPE_FILE_MODE : PROJECT_SCOPE_FILE_MODE, scope === 'user' ? USER_SCOPE_FILE_MODE : undefined);
        return {
            ...base,
            outcome: 'INSTALLED',
            detail: edited.existed
                ? `Updated the "${serverName}" entry in ${configPath}.`
                : `Added "${serverName}" to ${configPath}.`,
            backupPath: written.backupPath ?? undefined,
        };
    }
    catch (error) {
        return {
            ...base,
            outcome: 'FAILED',
            detail: `Could not write ${configPath}: ${error instanceof Error ? error.message : String(error)}. The original file was left unchanged.`,
            manualSnippet,
        };
    }
}
/**
 * Apply (or explicitly decline to apply) the AgentTeams entry for one client/scope.
 *
 * The profile is resolved here rather than at the command layer so every caller —
 * single install, batch install, and the snippets rendered from either — writes
 * the same catalog a client can actually load.
 */
export function installClient(options) {
    const resolved = resolveClientToolProfile(options.client, options.toolProfile ?? 'full', options.explicitToolProfile ?? false);
    const result = applyClient({ ...options, toolProfile: resolved.toolProfile });
    return {
        ...result,
        toolProfile: resolved.toolProfile,
        ...(resolved.notice ? { toolProfileNotice: resolved.notice } : {}),
    };
}
function applyClient(options) {
    const { client, scope } = options;
    const serverName = options.serverName ?? MCP_SERVER_NAME;
    const definition = client.scopes[scope];
    const configPath = definition.configPath(options.context);
    const displaySpec = buildServerSpec({
        serverEntry: options.serverEntry,
        context: options.context,
        toolProfile: options.toolProfile,
        scope,
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
/**
 * Detection plan for the no-argument `install`. Nothing here touches the
 * filesystem — the caller prints it and stops unless `--yes` was passed.
 */
export function buildBatchPlan(options) {
    const scope = options.scope ?? 'user';
    const detection = options.detection ?? detectClients({ context: options.context, ...(options.detectionDependencies ?? {}) });
    const entries = MCP_CLIENTS.map((client) => {
        const signal = detection.find((candidate) => candidate.clientId === client.id);
        const definition = client.scopes[scope];
        const detected = signal?.detected ?? false;
        const identityVerified = !client.executableIdentity || signal?.executablePath != null;
        // A vendor-command scope has nothing to write itself: it shells out to the client's
        // own CLI. Without a located executable the run would spawn a bare name that is not
        // on this PATH and report FAILED for a client that is merely configured elsewhere —
        // so it is skipped with a reason instead.
        const runnableVendorCommand = definition.strategy !== 'vendorCommand' || signal?.executablePath != null;
        const applicable = detected && identityVerified && runnableVendorCommand && definition.strategy !== 'configOnly';
        let reason;
        if (!detected)
            reason = 'Not detected on this machine.';
        else if (!identityVerified)
            reason = `No executable verified as ${client.label} was found.`;
        else if (!runnableVendorCommand)
            reason = `Detected from configuration only; no \`${client.executables[0]}\` executable was found to run its registration command.`;
        else if (definition.strategy === 'configOnly')
            reason = definition.configOnlyReason;
        return {
            clientId: client.id,
            label: client.label,
            evidence: signal?.evidence ?? 'none',
            executablePath: signal?.executablePath ?? null,
            configPaths: signal?.configPaths ?? [],
            scope,
            strategy: definition.strategy,
            targetPath: definition.configPath(options.context),
            detected,
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
/**
 * Apply the plan client by client. One client's failure must not strand the
 * rest, so every entry is attempted and the caller derives the exit code from
 * the collected outcomes.
 */
export function runBatchInstall(options) {
    const scope = options.scope ?? 'user';
    const plan = buildBatchPlan({ ...options, scope });
    const results = [];
    // Distinct clients can share one config file — `claude-code` and `copilot-cli` both
    // register into the project's `.mcp.json`, one through `claude mcp add` and one
    // through a JSON merge. Writing it twice in a single batch makes the second strategy
    // overwrite (and back up) what the first just wrote, and reports one file as two
    // registrations. The first writer owns the file; the rest report the entry it left.
    const writtenPaths = new Map();
    for (const entry of plan.entries) {
        const client = findClient(entry.clientId);
        if (!client)
            continue;
        // A detected config-only client still goes through `installClient`: it writes
        // nothing either way, but that path returns the manual snippet the user needs to
        // finish the registration by hand. Assembling the skip here instead dropped it.
        const needsManualFallback = entry.detected && entry.strategy === 'configOnly';
        if (!entry.applicable && !needsManualFallback) {
            // A client that is configured on this machine but whose CLI is missing is not
            // "not detected": installing that executable is the fix, and reporting both
            // states with one outcome hides that from every caller — `init --mcp` counts
            // the client as absent and says nothing at all about it.
            const missingExecutable = entry.detected && entry.strategy === 'vendorCommand' && !entry.executablePath;
            results.push({
                clientId: entry.clientId,
                scope: entry.scope,
                strategy: entry.strategy,
                configPath: entry.targetPath,
                outcome: missingExecutable ? 'SKIPPED_NO_EXECUTABLE' : 'SKIPPED_NOT_DETECTED',
                detail: entry.reason ?? 'Skipped.',
            });
            continue;
        }
        // Checked only for entries that would really be written: a client that is not even
        // installed must keep reporting why it was skipped, not inherit another client's
        // registration just because they name the same file.
        const owner = writtenPaths.get(entry.targetPath);
        if (owner) {
            results.push({
                clientId: entry.clientId,
                scope: entry.scope,
                strategy: entry.strategy,
                configPath: entry.targetPath,
                outcome: 'ALREADY_REGISTERED',
                detail: `${entry.targetPath} was already registered in this run by ${owner}; ${client.label} reads the same file.`,
            });
            continue;
        }
        const result = installClient({
            client,
            scope: entry.scope,
            credentials: options.credentials,
            context: options.context,
            serverEntry: options.serverEntry,
            serverName: options.serverName,
            vendorRunner: options.vendorRunner,
            toolProfile: options.toolProfile,
            explicitToolProfile: options.explicitToolProfile,
            executablePath: entry.executablePath,
        });
        results.push(result);
        // Only an outcome that means "this file now holds the entry" claims the path. A
        // config-only skip wrote nothing, so the next client targeting the same file must
        // still get its turn.
        if (result.outcome === 'INSTALLED' || result.outcome === 'ALREADY_REGISTERED') {
            writtenPaths.set(entry.targetPath, client.label);
        }
    }
    return { plan, results };
}
/** Non-zero exit only for real failures; "config only" and "not detected" are expected states. */
export function resolveInstallExitCode(results) {
    return results.some((result) => result.outcome === 'FAILED') ? 1 : 0;
}
export { renderConfigSnippet, renderVendorCommandLine };
//# sourceMappingURL=install.js.map