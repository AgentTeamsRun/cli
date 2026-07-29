import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { DEFAULT_API_URL, findProjectConfig, saveConfig, type PersistedConfig } from '../utils/config.js';
import { getPersonalTokenClient } from '../auth/personalTokenClient.js';
import {
  BACKUP_SUFFIX,
  PROJECT_SCOPE_FILE_MODE,
  USER_SCOPE_FILE_MODE,
  writeConfigFileAtomically,
} from './atomicWrite.js';
import { MCP_CLIENTS } from './clients.js';
import { McpConfigParseError, readContainerEntry, upsertContainerEntry } from './jsonc.js';
import { buildEntryValue } from './render.js';
import { buildServerSpec, MCP_SERVER_NAME } from './serverSpec.js';
import type { McpClientId, McpEntryShape, McpPathContext, McpScope } from './types.js';

/**
 * A `key_` that starts a value, not one embedded in a longer identifier.
 *
 * The lookbehind is what keeps `license_key_path` or `api_key_source` out of the
 * scan, and the length floor keeps a bare `key_x` out of it: an agent key is
 * always `key_{uuid}_{uuid}`. Matching those would make doctor report — and,
 * before the entry check below, rewrite — files that never held a credential.
 */
const KEY_PATTERN = /(?<![A-Za-z0-9_-])key_[A-Za-z0-9][A-Za-z0-9_-]{7,}/g;

type FindingKind = 'project-config' | 'mcp-config' | 'backup';
type CleanupOutcome = 'CLEANED' | 'SKIPPED' | 'FAILED';

interface CandidateDefinition {
  clientId: McpClientId;
  scope: McpScope;
  format: 'json' | 'jsonc' | 'toml';
  containerKey?: string;
  entryShape?: McpEntryShape;
}

interface ScanCandidate {
  path: string;
  kind: FindingKind;
  primaryPath?: string;
  definitions: CandidateDefinition[];
}

export interface McpDoctorFinding {
  path: string;
  kind: FindingKind;
  occurrences: number;
  clientIds: McpClientId[];
  scopes: McpScope[];
}

export interface McpDoctorCleanup {
  path: string;
  outcome: CleanupOutcome;
  detail: string;
}

export interface McpDoctorReport {
  confirmed: boolean;
  scannedFiles: number;
  findings: McpDoctorFinding[];
  cleanup: McpDoctorCleanup[];
  remainingFindings: McpDoctorFinding[];
}

export interface McpDoctorCommandOptions {
  /** Explicit confirmation. Without it doctor is a read-only audit. */
  yes?: boolean;
}

export interface McpDoctorDependencies {
  context?: Partial<McpPathContext>;
  hasValidPersonalCredential?: (apiUrl: string) => Promise<boolean>;
}

export interface McpDoctorCommandOutput {
  text: string;
  json: McpDoctorReport;
  exitCode: number;
}

function resolvePathContext(overrides?: Partial<McpPathContext>): McpPathContext {
  return {
    homeDir: overrides?.homeDir ?? homedir(),
    cwd: overrides?.cwd ?? process.cwd(),
    env: overrides?.env ?? process.env,
  };
}

function countKeyMaterial(source: string): number {
  return source.match(KEY_PATTERN)?.length ?? 0;
}

function redactKeyMaterial(value: string): string {
  return value.replace(KEY_PATTERN, '***');
}

function readSource(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function buildCandidates(context: McpPathContext): ScanCandidate[] {
  const candidates = new Map<string, ScanCandidate>();
  const projectConfigPath = findProjectConfig(context.cwd);

  if (projectConfigPath) {
    candidates.set(projectConfigPath, {
      path: projectConfigPath,
      kind: 'project-config',
      definitions: [],
    });
  }

  for (const client of MCP_CLIENTS) {
    for (const scope of ['user', 'project'] as const) {
      const definition = client.scopes[scope];
      const path = definition.configPath(context);
      const candidate = candidates.get(path) ?? { path, kind: 'mcp-config' as const, definitions: [] };
      candidate.definitions.push({
        clientId: client.id,
        scope,
        format: definition.format,
        containerKey: definition.containerKey,
        entryShape: definition.entryShape,
      });
      candidates.set(path, candidate);
    }
  }

  for (const primary of [...candidates.values()]) {
    const backupPath = `${primary.path}${BACKUP_SUFFIX}`;
    candidates.set(backupPath, {
      path: backupPath,
      kind: 'backup',
      primaryPath: primary.path,
      definitions: [...primary.definitions],
    });
  }

  return [...candidates.values()];
}

function scanCandidates(candidates: ScanCandidate[]): { scannedFiles: number; findings: McpDoctorFinding[] } {
  let scannedFiles = 0;
  const findings: McpDoctorFinding[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    scannedFiles += 1;
    const source = readSource(candidate.path);
    if (source === null) continue;
    const occurrences = countKeyMaterial(source);
    if (occurrences === 0) continue;

    findings.push({
      path: redactKeyMaterial(candidate.path),
      kind: candidate.kind,
      occurrences,
      clientIds: [...new Set(candidate.definitions.map((definition) => definition.clientId))],
      scopes: [...new Set(candidate.definitions.map((definition) => definition.scope))],
    });
  }

  return { scannedFiles, findings };
}

async function hasValidPersonalCredential(apiUrl: string): Promise<boolean> {
  const client = getPersonalTokenClient(apiUrl);
  if (!client.hasCredential()) return false;
  try {
    return Boolean(await client.getAccessToken());
  } catch {
    return false;
  }
}

async function cleanProjectConfig(
  candidate: ScanCandidate,
  dependencies: McpDoctorDependencies,
): Promise<McpDoctorCleanup> {
  const displayPath = redactKeyMaterial(candidate.path);
  const source = readSource(candidate.path);
  if (source === null) {
    return {
      path: displayPath,
      outcome: 'FAILED',
      detail: 'Could not read the project config; it was left unchanged.',
    };
  }

  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    config = parsed as Record<string, unknown>;
  } catch {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'The project config format was not recognized and was left unchanged.',
    };
  }

  if (
    typeof config.teamId !== 'string' ||
    config.teamId.length === 0 ||
    typeof config.projectId !== 'string' ||
    config.projectId.length === 0 ||
    typeof config.apiKey !== 'string' ||
    countKeyMaterial(config.apiKey) === 0
  ) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'The project config did not contain a removable legacy apiKey field and was left unchanged.',
    };
  }

  if (config.authMode !== 'personal-token') {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail:
        "The project has not completed personal-token migration. Run 'agentteams auth login' before removing its only credential.",
    };
  }

  const apiUrl = typeof config.apiUrl === 'string' && config.apiUrl.length > 0 ? config.apiUrl : DEFAULT_API_URL;
  const credentialCheck = dependencies.hasValidPersonalCredential ?? hasValidPersonalCredential;
  if (!(await credentialCheck(apiUrl))) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail:
        "No valid personal credential is available. Run 'agentteams auth login' and retry; the legacy apiKey was preserved.",
    };
  }

  const next = { ...config };
  delete next.apiKey;
  try {
    saveConfig(candidate.path, next as PersistedConfig);
    return {
      path: displayPath,
      outcome: 'CLEANED',
      detail: 'Removed only apiKey after validating the personal credential; all other project fields were preserved.',
    };
  } catch {
    return {
      path: displayPath,
      outcome: 'FAILED',
      detail: 'Could not atomically update the project config; it was left unchanged.',
    };
  }
}

function cleanMcpConfig(candidate: ScanCandidate, context: McpPathContext): McpDoctorCleanup {
  const displayPath = redactKeyMaterial(candidate.path);
  const editable = candidate.definitions.find(
    (definition) => definition.format !== 'toml' && typeof definition.containerKey === 'string',
  );
  if (!editable?.containerKey) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'This config format has no safe comment-preserving editor; it was left unchanged.',
    };
  }

  const source = readSource(candidate.path);
  if (source === null) {
    return { path: displayPath, outcome: 'FAILED', detail: 'Could not read the MCP config; it was left unchanged.' };
  }

  // Doctor cleans an entry it already owns; it never creates one. `upsertContainerEntry`
  // below is an upsert, so reaching it with no existing entry would register an MCP
  // server the user never asked for — in a file (`~/.claude.json` at user scope) that
  // also holds unrelated history whose `key_` traces are what pulled it into the scan.
  let existingEntry: unknown;
  try {
    existingEntry = readContainerEntry(source, editable.containerKey, MCP_SERVER_NAME);
  } catch (error) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail:
        error instanceof McpConfigParseError
          ? 'The MCP config could not be parsed and was left unchanged.'
          : 'The MCP config format was not recognized and was left unchanged.',
    };
  }

  if (existingEntry === undefined) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail:
        'AgentTeams is not registered in this config, so nothing was inserted; the key material it holds belongs to another tool and needs manual removal.',
    };
  }

  if (countKeyMaterial(JSON.stringify(existingEntry) ?? '') === 0) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'The AgentTeams entry was already secret-free; key material elsewhere in the file was left unchanged.',
    };
  }

  let edited;
  try {
    edited = upsertContainerEntry(source, {
      containerKey: editable.containerKey,
      entryKey: MCP_SERVER_NAME,
      entryValue: buildEntryValue(editable.entryShape ?? 'plain', buildServerSpec({ context })),
    });
  } catch (error) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail:
        error instanceof McpConfigParseError
          ? 'The MCP config could not be parsed and was left unchanged.'
          : 'The MCP config format was not recognized and was left unchanged.',
    };
  }

  if (edited.unchanged) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'The AgentTeams entry was already secret-free; key material elsewhere in the file was left unchanged.',
    };
  }

  const isUserScope = candidate.definitions.some((definition) => definition.scope === 'user');
  const mode = isUserScope ? USER_SCOPE_FILE_MODE : PROJECT_SCOPE_FILE_MODE;

  let written;
  try {
    written = writeConfigFileAtomically(candidate.path, edited.text, mode, isUserScope ? mode : undefined);
  } catch {
    return {
      path: displayPath,
      outcome: 'FAILED',
      detail: 'Could not atomically update the MCP config; the remaining location is reported below.',
    };
  }

  // The config is already rewritten at this point. A backup that refuses to unlink is a
  // leftover copy to report, not a reason to tell the user the cleanup failed and have
  // them repeat it.
  let backupNote = '';
  if (written.backupPath) {
    try {
      unlinkSync(written.backupPath);
    } catch {
      backupNote = ` The pre-edit backup still holds the old key material and could not be removed; delete it manually: ${written.backupPath}`;
    }
  }

  const remaining = countKeyMaterial(readSource(candidate.path) ?? '');
  return {
    path: displayPath,
    outcome: remaining === 0 ? 'CLEANED' : 'SKIPPED',
    detail:
      (remaining === 0
        ? 'Rewrote only the AgentTeams MCP entry with the secret-free runtime spec.'
        : 'The AgentTeams entry was cleaned, but unrelated key material remains and was not modified.') + backupNote,
  };
}

function cleanBackup(candidate: ScanCandidate): McpDoctorCleanup {
  const displayPath = redactKeyMaterial(candidate.path);
  if (!existsSync(candidate.path)) {
    return { path: displayPath, outcome: 'CLEANED', detail: 'The stale AgentTeams backup was already removed.' };
  }

  const primarySource = candidate.primaryPath ? readSource(candidate.primaryPath) : null;
  if (primarySource === null || countKeyMaterial(primarySource) > 0) {
    return {
      path: displayPath,
      outcome: 'SKIPPED',
      detail: 'The primary config is missing or still contains key material, so its recovery backup was preserved.',
    };
  }

  try {
    unlinkSync(candidate.path);
    return {
      path: displayPath,
      outcome: 'CLEANED',
      detail: 'Removed the stale AgentTeams backup after its primary was clean.',
    };
  } catch {
    return { path: displayPath, outcome: 'FAILED', detail: 'Could not remove the stale AgentTeams backup.' };
  }
}

function renderFinding(finding: McpDoctorFinding): string {
  const clients = finding.clientIds.length > 0 ? ` (${finding.clientIds.join(', ')})` : '';
  return `- ${finding.kind}: ${finding.path}${clients} — ${finding.occurrences} redacted key location(s)`;
}

function renderReport(report: McpDoctorReport): string {
  const lines = [
    `AgentTeams MCP doctor — scanned ${report.scannedFiles} existing config/backup file(s)`,
    `Found ${report.findings.length} file(s) containing legacy key material.`,
    ...report.findings.map(renderFinding),
  ];

  if (!report.confirmed) {
    lines.push('');
    lines.push('Audit only: no files were changed.');
    if (report.findings.length > 0) {
      lines.push('Re-run `agentteams mcp doctor --yes` to confirm the safe cleanup actions.');
    }
    return redactKeyMaterial(lines.join('\n'));
  }

  lines.push('');
  lines.push('Confirmed cleanup results:');
  lines.push(...report.cleanup.map((result) => `- [${result.outcome}] ${result.path} — ${result.detail}`));
  lines.push('');
  lines.push(`Remaining: ${report.remainingFindings.length} file(s) containing legacy key material.`);
  lines.push(...report.remainingFindings.map(renderFinding));
  return redactKeyMaterial(lines.join('\n'));
}

export async function runMcpDoctorCommand(
  options: McpDoctorCommandOptions,
  dependencies: McpDoctorDependencies = {},
): Promise<McpDoctorCommandOutput> {
  const context = resolvePathContext(dependencies.context);
  const candidates = buildCandidates(context);
  const initial = scanCandidates(candidates);

  if (!options.yes) {
    const report: McpDoctorReport = {
      confirmed: false,
      scannedFiles: initial.scannedFiles,
      findings: initial.findings,
      cleanup: [],
      remainingFindings: initial.findings,
    };
    return { text: renderReport(report), json: report, exitCode: 0 };
  }

  const candidateByPath = new Map(candidates.map((candidate) => [redactKeyMaterial(candidate.path), candidate]));
  const cleanup: McpDoctorCleanup[] = [];

  for (const finding of initial.findings.filter((item) => item.kind === 'project-config')) {
    const candidate = candidateByPath.get(finding.path);
    if (candidate) cleanup.push(await cleanProjectConfig(candidate, dependencies));
  }
  for (const finding of initial.findings.filter((item) => item.kind === 'mcp-config')) {
    const candidate = candidateByPath.get(finding.path);
    if (candidate) cleanup.push(cleanMcpConfig(candidate, context));
  }
  for (const finding of initial.findings.filter((item) => item.kind === 'backup')) {
    const candidate = candidateByPath.get(finding.path);
    if (candidate) cleanup.push(cleanBackup(candidate));
  }

  const after = scanCandidates(candidates);
  const report: McpDoctorReport = {
    confirmed: true,
    scannedFiles: initial.scannedFiles,
    findings: initial.findings,
    cleanup,
    remainingFindings: after.findings,
  };
  return {
    text: renderReport(report),
    json: report,
    exitCode: after.findings.length === 0 ? 0 : 1,
  };
}
