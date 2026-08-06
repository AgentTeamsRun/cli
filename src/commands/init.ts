import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { multiselect, isCancel, cancel } from '@clack/prompts';
import httpClient from '../utils/httpClient.js';
import open from 'open';
import {
  createAuthState,
  createPkcePair,
  isUnifiedSetupMetadataMissing,
  SETUP_LEGACY_AGENT_KEY_HINT,
  SETUP_METADATA_MISSING_HINT,
  startLocalAuthServer,
  startUnifiedSetupServer,
  type AuthServerResult,
  type UnifiedSetupResult,
} from '../utils/authServer.js';
import {
  DEFAULT_API_URL,
  findProjectConfig,
  loadProjectConfig,
  loadConfigWithCredential,
  planCredential,
  type CredentialPlan,
  type LegacyApiKeyPersistedConfig,
  type PersistedConfig,
  saveConfig,
  saveLegacyApiKeyConfig,
} from '../utils/config.js';
import { getPersonalTokenClient } from '../auth/personalTokenClient.js';
import { createSpinner, withSpinner } from '../utils/spinner.js';
import { withCommandContext } from '../utils/commandContext.js';
import { conventionDownload, conventionStatus, type ConventionStatusResult } from './convention.js';
import { executeDoctorCommand, type DoctorResult } from './doctor.js';
import type { AuthMode, Config } from '../types/index.js';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from '../utils/git.js';
import { canonicalizePath } from '../utils/path.js';
import { readOrCreateMachineId } from '../utils/machineId.js';
import { buildAuthHeaders } from '../utils/apiContext.js';
import {
  DEFAULT_CONVENTION_REFERENCE,
  ensureConventionEntryPoints,
  ensureLocalExclude,
  ensurePostCheckoutHook,
  isReadableRegularFile,
  resolveGitCommonDir,
  toAnchoredExcludePattern,
  type ConventionEntryPointState,
  type ConventionIssue,
  type EnsurePostCheckoutHookResult,
} from '../utils/conventionLink.js';

const AUTH_BASE_URL = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';

const AGENT_ENTRY_POINT_FILES = [
  { value: 'CLAUDE.md', label: 'CLAUDE.md', hint: 'Claude Code' },
  { value: 'AGENTS.md', label: 'AGENTS.md', hint: 'OpenCode / Codex' },
  { value: 'GEMINI.md', label: 'GEMINI.md', hint: 'Antigravity' },
  { value: '.cursor/rules/agentteams.mdc', label: '.cursor/rules/agentteams.mdc', hint: 'Cursor' },
] as const;
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const CONVENTION_FILE = 'convention.md';
const RELINK_BACKUP_NAME = 'agentteams-relink';

const AUTH_PATH_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs9s9+n0C8Z099LrOTlKB
83c2WluO/TxZFxJQ07XgfKJ2RG/8K2kvCwVKeSgzzBP/hmY2qWAgAOrXIoSHNYGt
EPX6qkbWQmE27pxmLk6dWdCdUJcEs3r7lfLlJU7BPCFmH6GozHDX7jR9VeGIDdxu
c2cX4cEfs01xffT2EK7lfNrYTmwlnB5WMEr0jX+DUfjb/7HfC6Fg8J6cacxdjvqy
kmeQx6wGzG3OtYytKoOgbCY7wuRFOFoCphNPbaRzofnob/QM3hfLIyvgPDq6f6qG
HVz0XnMxh/7GdXCHHBTasxC965LHgOcJRhMJ51vadetmX4Xv8yoo5zkAmvb37/yo
JwIDAQAB
-----END PUBLIC KEY-----`;

type InitOptions = {
  cwd?: string;
  /** Personal login is the default; `api-key` is the explicit compatibility path. */
  authMode?: AuthMode;
};

export type InitReadinessStatus = 'READY' | 'DEGRADED' | 'SKIPPED';
export type InitReadinessStage = 'project-binding' | 'credential' | 'convention-sync' | 'local-adapters';

export type InitReadinessIssue = {
  code: string;
  message: string;
};

export type InitReadinessStep = {
  stage: InitReadinessStage;
  status: InitReadinessStatus;
  issues: InitReadinessIssue[];
  retryCommand?: string;
};

export type AgentFileEntry = {
  relativePath: string;
  type: 'created' | 'example';
};

type OAuthInitResult = {
  success: true;
  authUrl: string;
  configPath: string;
  conventionPath: string;
  teamId: string;
  projectId: string;
  agentName: string;
  agentFiles: AgentFileEntry[];
  seedPlanId: string | null;
  seedPlanWebUrl: string | null;
  postCheckoutHook?: EnsurePostCheckoutHookResult;
  authMode: AuthMode;
  /** Set only on the personal-token path, where the credential lives outside the repository. */
  personalLogin?: { email: string; nickname: string; persisted: boolean };
  warning?: string;
  readiness: InitReadinessStep[];
};

export type WorktreeEntryPointState = ConventionEntryPointState;

export type WorktreeEntryPointEntry = {
  relativePath: string;
  state: WorktreeEntryPointState;
};

export type WorktreeInitResult = {
  success: true;
  mode: 'worktree';
  worktreePath: string;
  sourcePath: string;
  targetPath: string;
  materialization: 'symlink' | 'copy' | 'relinked' | 'existing' | 'blocked';
  entryPoints: WorktreeEntryPointEntry[];
  issues: ConventionIssue[];
  warning?: string;
};

export type ConfiguredProjectInitResult = {
  success: true;
  mode: 'configured-project';
  configPath: string;
  conventionPath: string;
  teamId: string;
  projectId: string;
  authMode: AuthMode;
  credentialSource: 'explicit-api-key' | 'personal-token' | 'config-api-key';
  conventionsUpdated: boolean;
  conventionStatus?: ConventionStatusResult;
  conventionError?: string;
  doctor: DoctorResult;
  readiness: InitReadinessStep[];
};

type InitResult = OAuthInitResult | WorktreeInitResult | ConfiguredProjectInitResult;

export type InitExecutionKind = 'linked-worktree' | 'configured-project' | 'new-project';

export type InitExecutionContext = {
  kind: InitExecutionKind;
  configPath: string | null;
  config: Partial<Config> | null;
  credentialPlan: CredentialPlan;
};

function isSshEnvironment(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encryptAuthPath(authPath: string): string {
  const sessionKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(authPath, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedSessionKey = publicEncrypt(
    {
      key: AUTH_PATH_PUBLIC_KEY_PEM,
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    sessionKey,
  );

  const payload = {
    ek: encodeBase64Url(encryptedSessionKey),
    iv: encodeBase64Url(iv),
    tag: encodeBase64Url(authTag),
    ct: encodeBase64Url(ciphertext),
  };

  return `v1.${encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
}

export function detectOsType(): 'MACOS' | 'LINUX' | 'WINDOWS' | undefined {
  if (process.platform === 'darwin') {
    return 'MACOS';
  }

  if (process.platform === 'linux') {
    return 'LINUX';
  }

  if (process.platform === 'win32') {
    return 'WINDOWS';
  }

  return undefined;
}

export type AuthorizeUrlInput = {
  port: number;
  projectName: string;
  authPathEnc?: string;
  osType?: string;
  state?: string;
  machineId?: string;
  /**
   * Present only on the unified setup path. It is what asks the web page to
   * finish selection *and* the personal-token consent on one screen; a web build
   * that does not know `flow=setup` simply ignores both parameters, which is why
   * the `--auth api-key` path must keep omitting them.
   */
  codeChallenge?: string;
};

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    port: String(input.port),
    projectName: input.projectName,
  });
  if (input.authPathEnc && input.authPathEnc.length > 0) {
    params.set('ap', input.authPathEnc);
  }
  if (input.osType && input.osType.length > 0) {
    params.set('ot', input.osType);
  }
  // Machine identity, shared with the runner installed on this machine. It is not a secret and is
  // only used to bind the agent to the runner that can actually reach this workspace.
  if (input.machineId && input.machineId.length > 0) {
    params.set('mid', input.machineId);
  }
  // The web page echoes this back through the callback; without it the local
  // server cannot tell this login apart from one someone else started.
  if (input.state && input.state.length > 0) {
    params.set('state', input.state);
  }
  if (input.codeChallenge && input.codeChallenge.length > 0) {
    params.set('code_challenge', input.codeChallenge);
    params.set('flow', 'setup');
  }
  return `${AUTH_BASE_URL}/cli/authorize?${params.toString()}`;
}

function printAuthorizeUrl(url: string): void {
  const displayUrl = (() => {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('ap')) {
        parsed.searchParams.set('ap', '[secure]');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  })();

  console.log('🚀 Complete a free login in 1 second to download the template:');
  console.log(displayUrl);
}

async function tryOpenBrowser(url: string): Promise<void> {
  printAuthorizeUrl(url);

  if (isSshEnvironment()) {
    return;
  }

  try {
    await open(url);
  } catch {
    // Already printed
  }
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

/**
 * Where the CLI talks to is the CLI's own decision. It used to come from the
 * browser callback payload, so anything that reached the local callback port
 * could redirect every later request — including the convention download whose
 * content becomes always-on agent rules.
 */
function resolveApiUrl(): string {
  return normalizeApiUrl(process.env.AGENTTEAMS_API_URL || DEFAULT_API_URL);
}

/**
 * What actually lands in `.agentteams/config.json`.
 *
 * The default document is deliberately secret-free. The callback's agent key is
 * used only in-process to fetch conventions and is revoked before init exits.
 * `apiUrl` is always explicit so the persisted schema is stable across default
 * and custom deployments.
 *
 * `authMode` is not decoration: it is the only on-disk marker that this project
 * *chose* the personal login. `planCredential` keys `optedIn` off it, and that
 * flag is what turns "config exists, credential missing" into "run `agentteams
 * auth login`" instead of the misleading "run `agentteams init` first" — the
 * exact state after `auth logout`, a fresh clone, or a wiped OS keychain.
 */
function toConfig(
  authResult: {
    teamId: string;
    projectId: string;
  },
  apiUrl: string,
): PersistedConfig {
  return {
    teamId: authResult.teamId,
    projectId: authResult.projectId,
    apiUrl,
    authMode: 'personal-token',
  };
}

/** Preserve the original config shape only for the explicit compatibility flag. */
function toLegacyApiKeyConfig(
  authResult: { teamId: string; projectId: string; apiKey: string },
  apiUrl: string,
): LegacyApiKeyPersistedConfig {
  const config: LegacyApiKeyPersistedConfig = {
    teamId: authResult.teamId,
    projectId: authResult.projectId,
    apiKey: authResult.apiKey,
  };
  if (apiUrl !== DEFAULT_API_URL) {
    config.apiUrl = apiUrl;
  }
  return config;
}

async function fetchConventionTemplate(
  authResult: {
    projectId: string;
    apiKey: string;
    configId: string;
  },
  apiUrl: string,
): Promise<string> {
  const response = await httpClient.get(
    `${apiUrl}/api/projects/${authResult.projectId}/agent-configs/${authResult.configId}/convention`,
    {
      headers: {
        ...buildAuthHeaders(authResult.apiKey),
        'Content-Type': 'application/json',
      },
    },
  );

  const content = response.data?.data?.content;
  if (typeof content !== 'string') {
    throw new Error('Invalid convention template response from server.');
  }

  return content;
}

async function promptAgentFileSelection(): Promise<string[]> {
  if (!process.stdin.isTTY) {
    return AGENT_ENTRY_POINT_FILES.map((f) => f.value);
  }

  const selected = await multiselect({
    message: 'Select agent entry point files to create:',
    options: AGENT_ENTRY_POINT_FILES.map((f) => ({
      value: f.value,
      label: f.label,
      hint: f.hint,
    })),
    initialValues: AGENT_ENTRY_POINT_FILES.map((f) => f.value),
    required: false,
  });

  if (isCancel(selected)) {
    cancel('Init cancelled.');
    process.exit(0);
  }

  return selected as string[];
}

function ensureGitignore(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.agentteams';

  const block = `# AgentTeams local config\n${entry}\n`;

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) {
      return;
    }
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    appendFileSync(gitignorePath, `${separator}${block}`, 'utf-8');
    console.log(`✅ Added ${entry} to .gitignore`);
  } else {
    writeFileSync(gitignorePath, `${block}`, 'utf-8');
    console.log(`✅ Created .gitignore with ${entry}`);
  }
}

function ensureGeminiIgnore(cwd: string): void {
  const geminiIgnorePath = join(cwd, '.geminiignore');
  const entry = '!.agentteams';

  if (existsSync(geminiIgnorePath)) {
    const content = readFileSync(geminiIgnorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) {
      return;
    }
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    appendFileSync(geminiIgnorePath, `${separator}# Allow AgentTeams convention files\n${entry}\n`, 'utf-8');
  } else {
    writeFileSync(geminiIgnorePath, `# Allow AgentTeams convention files\n${entry}\n`, 'utf-8');
  }
}

function generateAgentEntryPointFiles(cwd: string, selectedFiles: string[]): AgentFileEntry[] {
  if (selectedFiles.length === 0) {
    return [];
  }

  const entries: AgentFileEntry[] = [];

  for (const relativePath of selectedFiles) {
    const fullPath = join(cwd, relativePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, DEFAULT_CONVENTION_REFERENCE, 'utf-8');
      entries.push({ relativePath, type: 'created' });
    } else {
      const ext = relativePath.includes('.') ? `.${relativePath.split('.').pop()}` : '';
      const base = ext ? relativePath.slice(0, -ext.length) : relativePath;
      const exampleRelativePath = `${base}-example${ext}`;
      const exampleFullPath = join(cwd, exampleRelativePath);
      const exampleDir = dirname(exampleFullPath);
      if (!existsSync(exampleDir)) {
        mkdirSync(exampleDir, { recursive: true });
      }
      writeFileSync(exampleFullPath, DEFAULT_CONVENTION_REFERENCE, 'utf-8');
      entries.push({ relativePath: exampleRelativePath, type: 'example' });
    }
  }

  return entries;
}

function isConfiguredMainCheckout(sourcePath: string): boolean {
  try {
    const config = JSON.parse(readFileSync(join(sourcePath, CONFIG_FILE), 'utf-8')) as Record<string, unknown>;
    return ['teamId', 'projectId'].every((field) => typeof config[field] === 'string' && config[field].length > 0);
  } catch {
    return false;
  }
}

function isLinkedWorktreeWithConfiguredMainCheckout(cwd: string): boolean {
  let worktreePath: string;
  try {
    worktreePath = canonicalizePath(resolve(cwd));
  } catch {
    return false;
  }

  if (resolveGitTopLevel(worktreePath) !== worktreePath) return false;

  const mainCheckoutRoot = resolveMainCheckoutRoot(worktreePath);
  if (!mainCheckoutRoot) return false;

  const sourcePath = join(mainCheckoutRoot, CONFIG_DIR);
  return existsSync(sourcePath) && isConfiguredMainCheckout(sourcePath);
}

/**
 * Classify init before it opens a browser or materializes any local adapters.
 *
 * This resolver is intentionally read-only. The linked-worktree branch calls
 * `bootstrapLinkedWorktree` only after classification, while the configured
 * project branch can reuse the credential decision without consulting a
 * keychain or refreshing a token.
 */
export function detectInitExecutionContext(cwd: string, explicitAuthMode?: AuthMode): InitExecutionContext {
  const resolvedCwd = resolve(cwd);
  const configPath = findProjectConfig(resolvedCwd);
  const config = configPath ? loadProjectConfig(resolvedCwd) : null;
  const credentialPlan = planCredential(config ?? undefined);

  if (isLinkedWorktreeWithConfiguredMainCheckout(resolvedCwd)) {
    return { kind: 'linked-worktree', configPath, config, credentialPlan };
  }

  const hasProjectBinding =
    typeof config?.teamId === 'string' &&
    config.teamId.length > 0 &&
    typeof config.projectId === 'string' &&
    config.projectId.length > 0;

  // An explicit --auth choice means the caller intends to reconnect instead of
  // validating the existing binding through the configured-project fast path.
  const kind: InitExecutionKind =
    configPath && hasProjectBinding && !explicitAuthMode ? 'configured-project' : 'new-project';

  return { kind, configPath, config, credentialPlan };
}

/**
 * Materialize the worktree's `.agentteams` entry as a real link.
 *
 * Windows directory symlinks require SeCreateSymbolicLinkPrivilege (Developer
 * Mode or elevation), so an unprivileged win32 run fails with EPERM and used to
 * fall through to a copy — silently breaking the guarantee that a worktree
 * tracks the main checkout's conventions. Junctions need no privilege, which is
 * why `utils/conventionLink.ts` and the daemon's worktree helper already use
 * them; this is the same documented platform exception.
 *
 * The copy fallback stays for environments neither link type supports (UNC
 * paths, filesystems without reparse points). It dereferences because in a
 * non-git-root layout the source is itself a link, and copying a link
 * recursively re-creates it — which fails for exactly the same reason.
 */
function linkConventionDir(
  sourcePath: string,
  targetPath: string,
): { materialization: 'symlink' | 'copy'; warning?: string } {
  try {
    if (process.platform === 'win32') {
      // Junctions only accept absolute targets, so resolve the chain first.
      symlinkSync(realpathSync(sourcePath), targetPath, 'junction');
    } else {
      symlinkSync(sourcePath, targetPath, 'dir');
    }
    return { materialization: 'symlink' };
  } catch (error) {
    cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    return {
      materialization: 'copy',
      warning: `Could not create the .agentteams symlink (${error instanceof Error ? error.message : String(error)}). Copied the directory instead.`,
    };
  }
}

/**
 * Decide whether a plain directory sitting at the worktree's `.agentteams` may
 * be the copy an earlier failed link attempt left behind, rather than something
 * the user created. Identity is judged by the config file, the one artifact a
 * copy reproduces byte for byte — anything else is treated as the user's and is
 * never touched. This only authorizes moving the directory aside; whether the
 * moved copy may be deleted is decided separately by `findCopyOnlyFiles`.
 */
function isCopyOfMainCheckout(sourcePath: string, targetPath: string): boolean {
  try {
    return (
      readFileSync(join(targetPath, CONFIG_FILE), 'utf-8') === readFileSync(join(sourcePath, CONFIG_FILE), 'utf-8')
    );
  } catch {
    return false;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasIdenticalFile(sourceFile: string, backupFile: string): boolean {
  try {
    const sourceStats = statSync(sourceFile);
    if (!sourceStats.isFile() || sourceStats.size !== statSync(backupFile).size) return false;
    return readFileSync(sourceFile).equals(readFileSync(backupFile));
  } catch {
    return false;
  }
}

/**
 * List every file in the moved-aside copy that the main checkout does not
 * already hold byte for byte. A worktree that ran as a copy accumulates its own
 * artifacts inside `.agentteams` — runner history, evidence, downloaded plans,
 * review findings — and none of them can be regenerated, so the copy is only
 * safe to delete when it is a strict subset of the source. Anything that is not
 * a plain matching file (a symlink, a special file, an unreadable directory)
 * counts as copy-only: it cannot be proven redundant.
 */
function findCopyOnlyFiles(backupPath: string, sourcePath: string): string[] {
  const copyOnlyFiles: string[] = [];

  const walk = (relativeDir: string): void => {
    let entries;
    try {
      entries = readdirSync(join(backupPath, relativeDir), { withFileTypes: true });
    } catch {
      copyOnlyFiles.push(relativeDir || '.');
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (!entry.isFile() || !hasIdenticalFile(join(sourcePath, relativePath), join(backupPath, relativePath))) {
        copyOnlyFiles.push(relativePath);
      }
    }
  };

  walk('');
  return copyOnlyFiles;
}

/**
 * Park the copy outside every tracked surface while the link is created. A
 * backup next to `.agentteams` would show up in `git status` — the anchored
 * `/.agentteams` exclude is an exact match and does not cover a sibling name —
 * and a copied legacy `config.json` may carry the project apiKey.
 * `git-common-dir` is part of no working tree, so nothing can surface from
 * there. A worktree on a different volume cannot be renamed into it, and only
 * then does the in-worktree fallback apply — after registering its own exclude
 * pattern.
 */
function moveConventionCopyAside(worktreePath: string, targetPath: string): { backupPath: string } | { error: string } {
  const failures: string[] = [];

  const commonDir = resolveGitCommonDir(worktreePath);
  if (commonDir) {
    const backupPath = join(commonDir, `${RELINK_BACKUP_NAME}-${process.pid}`);
    try {
      renameSync(targetPath, backupPath);
      return { backupPath };
    } catch (error) {
      failures.push(toErrorMessage(error));
    }
  }

  const excludeResult = ensureLocalExclude(worktreePath, [toAnchoredExcludePattern(`.${RELINK_BACKUP_NAME}`)]);
  if (excludeResult.status !== 'ready') {
    failures.push(
      `the in-worktree backup cannot be kept out of git status (${excludeResult.issue?.message ?? 'local exclude is blocked'})`,
    );
    return { error: failures.join('; ') };
  }

  try {
    const backupPath = join(worktreePath, `.${RELINK_BACKUP_NAME}`);
    renameSync(targetPath, backupPath);
    return { backupPath };
  } catch (error) {
    failures.push(toErrorMessage(error));
    return { error: failures.join('; ') };
  }
}

/** Undo the move-aside. The target may hold a fresh link or a partial copy, and
 * `renameSync` onto a non-empty directory fails with ENOTEMPTY, so clear it
 * first and never let the restore itself escape as an exception. */
function restoreConventionCopy(backupPath: string, targetPath: string): boolean {
  try {
    rmSync(targetPath, { recursive: true, force: true });
    renameSync(backupPath, targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace a copied `.agentteams` directory with a real link so a worktree that
 * predates the link fix starts tracking the main checkout again. Without this
 * the `existing` branch treats the copy as settled and the worktree keeps
 * serving stale conventions forever.
 *
 * The copy is moved aside first and is deleted only once the link is in place
 * *and* the copy proves to be a strict subset of the main checkout; otherwise
 * the backup is kept and its path reported. Any failure restores the original
 * directory, and a failed restore reports where the original is.
 */
function promoteCopiedConventionDir(
  worktreePath: string,
  sourcePath: string,
  targetPath: string,
): { materialization: 'relinked' | 'existing'; issue?: ConventionIssue } {
  if (!isCopyOfMainCheckout(sourcePath, targetPath)) {
    return {
      materialization: 'existing',
      issue: {
        code: 'link-occupied',
        path: targetPath,
        message: `The directory at ${targetPath} does not match the main checkout's ${CONFIG_DIR}; leaving it untouched. Remove it manually to restore the convention link.`,
      },
    };
  }

  const moved = moveConventionCopyAside(worktreePath, targetPath);
  if ('error' in moved) {
    return {
      materialization: 'existing',
      issue: {
        code: 'link-create-failed',
        path: targetPath,
        message: `Could not move the copied ${CONFIG_DIR} aside at ${targetPath}: ${moved.error}`,
      },
    };
  }
  const { backupPath } = moved;

  try {
    const { materialization } = linkConventionDir(sourcePath, targetPath);
    // A copy fallback here would only rebuild the state being replaced.
    if (materialization !== 'symlink') {
      throw new Error('the link could not be created and a copy would not restore the convention chain');
    }
  } catch (error) {
    const restored = restoreConventionCopy(backupPath, targetPath);
    return {
      materialization: 'existing',
      issue: {
        code: 'link-create-failed',
        path: targetPath,
        message: restored
          ? `Could not relink ${targetPath} to the main checkout: ${toErrorMessage(error)}`
          : `Could not relink ${targetPath} to the main checkout: ${toErrorMessage(error)}. The original ${CONFIG_DIR} was left at ${backupPath}; move it back manually.`,
      },
    };
  }

  const copyOnlyFiles = findCopyOnlyFiles(backupPath, sourcePath);
  if (copyOnlyFiles.length > 0) {
    return {
      materialization: 'relinked',
      issue: {
        code: 'link-backup-retained',
        path: backupPath,
        message: `Kept ${copyOnlyFiles.length} file(s) that exist only in the replaced ${CONFIG_DIR} copy (${copyOnlyFiles.slice(0, 3).join(', ')}${copyOnlyFiles.length > 3 ? ', …' : ''}) at ${backupPath}; move what you still need out of it and delete it.`,
      },
    };
  }

  rmSync(backupPath, { recursive: true, force: true });
  return { materialization: 'relinked' };
}

function isBrokenSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && !existsSync(path);
  } catch {
    return false;
  }
}

export function bootstrapLinkedWorktree(cwd: string): WorktreeInitResult | null {
  let worktreePath: string;
  try {
    worktreePath = canonicalizePath(resolve(cwd));
  } catch {
    return null;
  }

  if (resolveGitTopLevel(worktreePath) !== worktreePath) return null;

  const mainCheckoutRoot = resolveMainCheckoutRoot(worktreePath);
  if (!mainCheckoutRoot) return null;

  const sourcePath = join(mainCheckoutRoot, CONFIG_DIR);
  if (!existsSync(sourcePath) || !isConfiguredMainCheckout(sourcePath)) return null;

  // The convention root is the parent of the canonical .agentteams directory.
  // Following the canonical path resolves double links as well
  // (worktree/.agentteams → member/.agentteams → non-git-root/.agentteams),
  // so the entry point set is read from the actual root — not the member repo.
  let conventionRoot: string | null = null;
  try {
    conventionRoot = dirname(canonicalizePath(sourcePath));
  } catch {
    conventionRoot = null;
  }

  const selectedEntryPoints = conventionRoot
    ? AGENT_ENTRY_POINT_FILES.map((f) => f.value).filter((relativePath) =>
        isReadableRegularFile(join(conventionRoot, relativePath)),
      )
    : [];

  // Local exclude registration comes before creating any managed path so a
  // bootstrap never dirties the shared repository state.
  const issues: ConventionIssue[] = [];
  const excludeResult = ensureLocalExclude(worktreePath, [
    toAnchoredExcludePattern(CONFIG_DIR),
    ...selectedEntryPoints.map(toAnchoredExcludePattern),
  ]);
  if (excludeResult.status === 'blocked' && excludeResult.issue) {
    issues.push(excludeResult.issue);
  }
  const excludeReady = excludeResult.status === 'ready';

  const targetPath = join(worktreePath, CONFIG_DIR);
  let materialization: WorktreeInitResult['materialization'];
  let warning: string | undefined;

  if (!excludeReady) {
    materialization = existsSync(targetPath) ? 'existing' : 'blocked';
  } else if (isBrokenSymbolicLink(targetPath)) {
    unlinkSync(targetPath);
    ({ materialization, warning } = linkConventionDir(sourcePath, targetPath));
  } else if (existsSync(targetPath)) {
    // An entry that is already a link is settled; a plain directory is either a
    // copy left by a failed link attempt or something the user put there.
    if (lstatSync(targetPath).isSymbolicLink()) {
      materialization = 'existing';
    } else {
      const promotion = promoteCopiedConventionDir(worktreePath, sourcePath, targetPath);
      materialization = promotion.materialization;
      if (promotion.issue) {
        issues.push(promotion.issue);
      }
    }
  } else {
    ({ materialization, warning } = linkConventionDir(sourcePath, targetPath));
  }

  const entryPointResult = ensureConventionEntryPoints(worktreePath, selectedEntryPoints, {
    allowCreate: excludeReady,
    validateExistingReference: false,
  });
  issues.push(...entryPointResult.issues);
  const entryPoints = entryPointResult.entries.map(({ relativePath, state }) => ({ relativePath, state }));

  const result: WorktreeInitResult = {
    success: true,
    mode: 'worktree',
    worktreePath,
    sourcePath,
    targetPath,
    materialization,
    entryPoints,
    issues,
  };

  if (warning) {
    result.warning = warning;
  }

  return result;
}

export async function executeInitCommand(options?: InitOptions): Promise<InitResult> {
  return withCommandContext('init', () => executeInitCommandWithContext(options));
}

/**
 * Wait for the browser round trip without losing Ctrl+C.
 *
 * Shared by both auth paths so the cancel handling — SIGINT plus the raw-mode
 * ^C read a spinner would otherwise swallow — exists exactly once.
 */
async function waitForBrowserCallback<T>(
  authContext: AuthServerResult<T>,
  spinner: ReturnType<typeof createSpinner>,
): Promise<T> {
  let restored = false;

  // Runs on every exit — success, timeout, or server error. Leaving it on the
  // success path only meant a failed init handed the shell back in raw mode,
  // with input no longer echoing until the user typed `reset`.
  const restoreTerminal = (): void => {
    if (restored) {
      return;
    }
    restored = true;

    process.removeListener('SIGINT', onSigint);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onKeypress);
    }
  };

  function onSigint(): void {
    restoreTerminal();
    spinner?.fail('Init cancelled.');
    if (authContext.server.listening) {
      authContext.server.close();
    }
    process.exit(0);
  }

  function onKeypress(key: Buffer): void {
    if (key[0] === 0x03) {
      onSigint();
    }
  }

  process.on('SIGINT', onSigint);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onKeypress);
  }

  try {
    return await authContext.waitForCallback();
  } finally {
    restoreTerminal();
  }
}

type SetupContext = {
  cwd: string;
  projectName: string;
  apiUrl: string;
  configPath: string;
  conventionPath: string;
  authPathEnc: string | undefined;
};

type SetupOutcome = {
  authUrl: string;
  teamId: string;
  projectId: string;
  agentName: string;
  seedPlanId: string | null;
  personalLogin?: OAuthInitResult['personalLogin'];
};

/**
 * The default path: one browser screen, no agent API key, one convention write.
 *
 * The browser returns an authorization code plus the connection identifiers, so
 * the second round trip that used to run here (`performPersonalTokenLogin`) is
 * gone, and with it the `key_` that only ever existed to read the convention
 * template once. `agentteams auth login` still owns that helper for the
 * project-less login.
 */
async function runUnifiedSetup(context: SetupContext): Promise<SetupOutcome> {
  const pkce = createPkcePair();

  let server;
  try {
    server = await startUnifiedSetupServer({ state: createAuthState() });
  } catch (error) {
    throw new Error(`Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`);
  }

  const authUrl = buildAuthorizeUrl({
    port: server.port,
    projectName: context.projectName,
    authPathEnc: context.authPathEnc,
    osType: detectOsType(),
    state: server.state,
    machineId: readOrCreateMachineId() ?? undefined,
    codeChallenge: pkce.challenge,
  });
  await tryOpenBrowser(authUrl);

  const authSpinner = createSpinner('Waiting for authentication... (Ctrl+C to cancel)');

  try {
    const callback = await waitForBrowserCallback(server, authSpinner);
    authSpinner?.succeed();

    if (isUnifiedSetupMetadataMissing(callback)) {
      throw new Error(callback.legacyAgentKeyIssued ? SETUP_LEGACY_AGENT_KEY_HINT : SETUP_METADATA_MISSING_HINT);
    }

    const setup: UnifiedSetupResult = callback;

    // Storing the credential comes before `saveConfig` on purpose: a login that
    // cannot be kept throws here, so init stops rather than leaving a project
    // configured for a credential nothing can find.
    const client = getPersonalTokenClient(context.apiUrl);
    const session = await client.exchangeAuthorizationCode({
      code: setup.code,
      codeVerifier: pkce.verifier,
      // Must match the redirect the web registered the code against.
      redirectUri: `http://localhost:${server.port}/callback`,
    });

    saveConfig(context.configPath, toConfig(setup, context.apiUrl));

    // The identifiers are passed explicitly rather than re-read from disk: this
    // command may run against a `cwd` that is not `process.cwd()`, and the
    // config resolver only ever looks at the latter.
    const runtimeConfig = await loadConfigWithCredential({
      teamId: setup.teamId,
      projectId: setup.projectId,
      apiUrl: context.apiUrl,
      authMode: 'personal-token',
    });

    // Falling back to a bare `conventionDownload()` here would undo the sentence
    // above: with no config passed it re-resolves the project from
    // `process.cwd()`, so an `init --cwd` (a worktree bootstrap included) would
    // quietly pull conventions for whichever project the shell happens to sit
    // in. Fail instead — this only happens if credential resolution regressed.
    if (!runtimeConfig) {
      throw new Error(
        'Signed in, but the stored credential could not be read back, so the convention template was not downloaded. ' +
          'Check `agentteams auth status`, then run `agentteams convention download` in this folder.',
      );
    }

    // The convention template is now written by `conventionDownload` alone —
    // exactly one write of `.agentteams/convention.md` per init — using the
    // agent this setup actually created instead of "whichever config is first".
    await conventionDownload({
      cwd: context.cwd,
      agentConfigId: setup.configId,
      config: runtimeConfig,
    });

    return {
      authUrl,
      teamId: setup.teamId,
      projectId: setup.projectId,
      agentName: setup.agentName,
      seedPlanId: setup.seedPlanId ?? null,
      personalLogin: {
        email: session.identity.email,
        nickname: session.identity.nickname,
        persisted: client.state().persisted,
      },
    };
  } catch (error) {
    authSpinner?.fail();
    if (server.server.listening) {
      server.server.close();
    }
    throw error;
  }
}

/**
 * The explicit `--auth api-key` compatibility path, unchanged.
 *
 * It keeps the legacy authorize URL (no `flow=setup`, no `code_challenge`), the
 * legacy callback payload with its `key_`, and the direct convention write. CI
 * users depend on this shape, so it is isolated from the default path rather
 * than sharing a branch with it.
 */
async function runLegacyApiKeySetup(context: SetupContext): Promise<SetupOutcome> {
  let authContext;
  try {
    authContext = await startLocalAuthServer({ state: createAuthState() });
  } catch (error) {
    throw new Error(`Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`);
  }

  const authUrl = buildAuthorizeUrl({
    port: authContext.port,
    projectName: context.projectName,
    authPathEnc: context.authPathEnc,
    osType: detectOsType(),
    state: authContext.state,
    machineId: readOrCreateMachineId() ?? undefined,
  });
  await tryOpenBrowser(authUrl);

  const authSpinner = createSpinner('Waiting for authentication... (Ctrl+C to cancel)');

  try {
    const authResult = await waitForBrowserCallback(authContext, authSpinner);
    authSpinner?.succeed();

    const runtimeConfig: Config = {
      teamId: authResult.teamId,
      projectId: authResult.projectId,
      apiKey: authResult.apiKey,
      apiUrl: context.apiUrl,
    };
    const conventionContent = await withSpinner('Fetching convention template...', () =>
      fetchConventionTemplate(authResult, context.apiUrl),
    );

    saveLegacyApiKeyConfig(context.configPath, toLegacyApiKeyConfig(authResult, context.apiUrl));
    writeFileSync(context.conventionPath, conventionContent, 'utf-8');
    await conventionDownload({ cwd: context.cwd, config: runtimeConfig });

    return {
      authUrl,
      teamId: authResult.teamId,
      projectId: authResult.projectId,
      agentName: authResult.agentName,
      seedPlanId: authResult.seedPlanId ?? null,
    };
  } catch (error) {
    authSpinner?.fail();
    if (authContext.server.listening) {
      authContext.server.close();
    }
    throw error;
  }
}

async function runConfiguredProjectInit(
  cwd: string,
  executionContext: InitExecutionContext,
): Promise<ConfiguredProjectInitResult> {
  const configPath = executionContext.configPath;
  const projectConfig = executionContext.config;
  if (!configPath || !projectConfig) {
    throw new Error(
      'The configured project could not be read. Run `agentteams init --auth personal-token` to relink it.',
    );
  }

  const runtimeConfig = await loadConfigWithCredential(projectConfig);
  if (!runtimeConfig) {
    throw new Error("The existing project binding has no usable credential. Run 'agentteams auth login'.");
  }

  let freshness: ConventionStatusResult | undefined;
  let conventionError: string | undefined;
  let conventionsUpdated = false;
  try {
    freshness = await conventionStatus({ cwd, config: runtimeConfig });
    if (freshness.conventionUpdateAvailable) {
      await conventionDownload({ cwd, config: runtimeConfig });
      conventionsUpdated = true;
    }
  } catch (error) {
    conventionError = toErrorMessage(error);
  }

  const doctor = await executeDoctorCommand({ cwd });
  const configuredAuthMode: AuthMode =
    runtimeConfig.credentialSource === 'personal-token' ? 'personal-token' : 'api-key';
  const readiness = buildConfiguredProjectReadiness(conventionError, doctor);

  return {
    success: true,
    mode: 'configured-project',
    configPath,
    conventionPath: join(dirname(configPath), CONVENTION_FILE),
    teamId: runtimeConfig.teamId,
    projectId: runtimeConfig.projectId,
    authMode: configuredAuthMode,
    credentialSource: runtimeConfig.credentialSource,
    conventionsUpdated,
    ...(freshness ? { conventionStatus: freshness } : {}),
    ...(conventionError ? { conventionError } : {}),
    doctor,
    readiness,
  };
}

function buildConfiguredProjectReadiness(
  conventionError: string | undefined,
  doctor: DoctorResult,
): InitReadinessStep[] {
  const conventionStep: InitReadinessStep = conventionError
    ? {
        stage: 'convention-sync',
        status: 'DEGRADED',
        issues: [{ code: 'convention-sync-failed', message: conventionError }],
        retryCommand: 'agentteams convention download',
      }
    : { stage: 'convention-sync', status: 'READY', issues: [] };

  let localAdaptersStep: InitReadinessStep;
  if (doctor.status === 'NOT_APPLICABLE') {
    localAdaptersStep = {
      stage: 'local-adapters',
      status: 'SKIPPED',
      issues: doctor.issues.map(({ code, message }) => ({ code, message })),
    };
  } else if (doctor.status === 'DEGRADED') {
    localAdaptersStep = {
      stage: 'local-adapters',
      status: 'DEGRADED',
      issues:
        doctor.issues.length > 0
          ? doctor.issues.map(({ code, message }) => ({ code, message }))
          : [{ code: 'doctor-degraded', message: 'Local adapters still need attention.' }],
      retryCommand: 'agentteams doctor',
    };
  } else {
    localAdaptersStep = { stage: 'local-adapters', status: 'READY', issues: [] };
  }

  return [
    { stage: 'project-binding', status: 'READY', issues: [] },
    { stage: 'credential', status: 'READY', issues: [] },
    conventionStep,
    localAdaptersStep,
  ];
}

function buildNewProjectReadiness(postCheckoutHook?: EnsurePostCheckoutHookResult): InitReadinessStep[] {
  const localAdaptersStep: InitReadinessStep =
    postCheckoutHook?.status === 'blocked'
      ? {
          stage: 'local-adapters',
          status: 'DEGRADED',
          issues: [
            {
              code: postCheckoutHook.issue?.code ?? 'post-checkout-hook-blocked',
              message: postCheckoutHook.issue?.message ?? 'The worktree bootstrap hook could not be installed.',
            },
          ],
          retryCommand: 'agentteams doctor',
        }
      : { stage: 'local-adapters', status: 'READY', issues: [] };

  return [
    { stage: 'project-binding', status: 'READY', issues: [] },
    { stage: 'credential', status: 'READY', issues: [] },
    { stage: 'convention-sync', status: 'READY', issues: [] },
    localAdaptersStep,
  ];
}

async function executeInitCommandWithContext(options?: InitOptions): Promise<InitResult> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  // Only an explicit compatibility request goes through the agent-key round trip.
  const authMode: AuthMode = options?.authMode === 'api-key' ? 'api-key' : 'personal-token';
  const executionContext = detectInitExecutionContext(cwd, options?.authMode);
  if (executionContext.kind === 'linked-worktree') {
    const worktreeResult = bootstrapLinkedWorktree(cwd);
    if (worktreeResult) return worktreeResult;
  }
  if (executionContext.kind === 'configured-project') {
    try {
      return await runConfiguredProjectInit(cwd, executionContext);
    } catch (error) {
      throw new Error(`Initialization failed: ${toErrorMessage(error)}`);
    }
  }

  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
  const conventionPath = join(cwd, CONFIG_DIR, CONVENTION_FILE);

  let authPathEnc: string | undefined;
  try {
    authPathEnc = encryptAuthPath(cwd);
  } catch {
    authPathEnc = undefined;
  }

  const context: SetupContext = {
    cwd,
    projectName: basename(cwd),
    apiUrl: resolveApiUrl(),
    configPath,
    conventionPath,
    authPathEnc,
  };

  let setup: SetupOutcome;
  try {
    setup = authMode === 'api-key' ? await runLegacyApiKeySetup(context) : await runUnifiedSetup(context);
  } catch (error) {
    throw new Error(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  ensureGitignore(cwd);
  const selectedFiles = await promptAgentFileSelection();
  if (selectedFiles.includes('GEMINI.md')) {
    ensureGeminiIgnore(cwd);
  }
  const agentFiles = generateAgentEntryPointFiles(cwd, selectedFiles);

  const seedPlanId = setup.seedPlanId;
  const seedPlanWebUrl = seedPlanId ? `${AUTH_BASE_URL.replace(/\/+$/, '')}/go?type=plan&id=${seedPlanId}` : null;

  // A git-root project shares one hooks directory with all its worktrees, so
  // installing the managed post-checkout hook here lets future `git worktree
  // add` runs bootstrap conventions automatically (via `agentteams init`).
  // Non-git roots (a parent folder grouping member repos) have no git-common
  // dir; `agentteams doctor` owns their per-member hooks instead, so skip.
  let postCheckoutHook: EnsurePostCheckoutHookResult | undefined;
  if (resolveGitTopLevel(cwd) !== null) {
    postCheckoutHook = ensurePostCheckoutHook(cwd);
  }

  return {
    success: true,
    authUrl: setup.authUrl,
    configPath,
    conventionPath,
    teamId: setup.teamId,
    projectId: setup.projectId,
    agentName: setup.agentName,
    agentFiles,
    seedPlanId,
    seedPlanWebUrl,
    postCheckoutHook,
    authMode,
    readiness: buildNewProjectReadiness(postCheckoutHook),
    ...(setup.personalLogin ? { personalLogin: setup.personalLogin } : {}),
  };
}
