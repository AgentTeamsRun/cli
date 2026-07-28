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
import { createAuthState, startLocalAuthServer } from '../utils/authServer.js';
import { DEFAULT_API_URL, type PersistedConfig, saveConfig } from '../utils/config.js';
import { createSpinner, withSpinner } from '../utils/spinner.js';
import { withCommandContext } from '../utils/commandContext.js';
import { conventionDownload } from './convention.js';
import type { Config } from '../types/index.js';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from '../utils/git.js';
import { canonicalizePath } from '../utils/path.js';
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

type InitResult = OAuthInitResult | WorktreeInitResult;

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

export function buildAuthorizeUrl(
  port: number,
  projectName: string,
  authPathEnc?: string,
  osType?: string,
  state?: string,
): string {
  const params = new URLSearchParams({
    port: String(port),
    projectName,
  });
  if (authPathEnc && authPathEnc.length > 0) {
    params.set('ap', authPathEnc);
  }
  if (osType && osType.length > 0) {
    params.set('ot', osType);
  }
  // The web page echoes this back through the callback; without it the local
  // server cannot tell this login apart from one someone else started.
  if (state && state.length > 0) {
    params.set('state', state);
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

function toConfig(
  authResult: {
    teamId: string;
    projectId: string;
    agentName: string;
    apiKey: string;
  },
  apiUrl: string,
): PersistedConfig {
  const config: PersistedConfig = {
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
    return ['teamId', 'projectId', 'apiKey'].every(
      (field) => typeof config[field] === 'string' && config[field].length > 0,
    );
  } catch {
    return false;
  }
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
 * and the copied `config.json` carries the project apiKey. `git-common-dir` is
 * part of no working tree, so nothing can surface from there. A worktree on a
 * different volume cannot be renamed into it, and only then does the
 * in-worktree fallback apply — after registering its own exclude pattern.
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

async function executeInitCommandWithContext(options?: InitOptions): Promise<InitResult> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const worktreeResult = bootstrapLinkedWorktree(cwd);
  if (worktreeResult) return worktreeResult;

  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
  const conventionPath = join(cwd, CONFIG_DIR, CONVENTION_FILE);

  const projectName = basename(cwd);

  let authContext;

  try {
    authContext = await startLocalAuthServer({ state: createAuthState() });
  } catch (error) {
    throw new Error(`Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`);
  }

  let authPathEnc: string | undefined;
  try {
    authPathEnc = encryptAuthPath(cwd);
  } catch {
    authPathEnc = undefined;
  }

  const authUrl = buildAuthorizeUrl(authContext.port, projectName, authPathEnc, detectOsType(), authContext.state);
  await tryOpenBrowser(authUrl);

  const authSpinner = createSpinner('Waiting for authentication... (Ctrl+C to cancel)');

  const cleanup = () => {
    if (authContext.server.listening) {
      authContext.server.close();
    }
  };

  try {
    const authResult = await new Promise<Awaited<ReturnType<typeof authContext.waitForCallback>>>((resolve, reject) => {
      const onSigint = () => {
        authSpinner?.fail('Init cancelled.');
        cleanup();
        process.exit(0);
      };

      process.on('SIGINT', onSigint);

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (key: Buffer) => {
          if (key[0] === 0x03) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            onSigint();
          }
        });
      }

      authContext
        .waitForCallback()
        .then((result) => {
          process.removeListener('SIGINT', onSigint);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeAllListeners('data');
          }
          resolve(result);
        })
        .catch(reject);
    });

    authSpinner?.succeed();
    const apiUrl = resolveApiUrl();
    const config = toConfig(authResult, apiUrl);
    const runtimeConfig: Config = {
      ...config,
      apiUrl,
    };
    const conventionContent = await withSpinner('Fetching convention template...', () =>
      fetchConventionTemplate(authResult, apiUrl),
    );

    saveConfig(configPath, config);
    writeFileSync(conventionPath, conventionContent, 'utf-8');
    await conventionDownload({ cwd, config: runtimeConfig });
    ensureGitignore(cwd);
    const selectedFiles = await promptAgentFileSelection();
    if (selectedFiles.includes('GEMINI.md')) {
      ensureGeminiIgnore(cwd);
    }
    const agentFiles = generateAgentEntryPointFiles(cwd, selectedFiles);

    const seedPlanId = authResult.seedPlanId ?? null;
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
      authUrl,
      configPath,
      conventionPath,
      teamId: authResult.teamId,
      projectId: authResult.projectId,
      agentName: authResult.agentName,
      agentFiles,
      seedPlanId,
      seedPlanWebUrl,
      postCheckoutHook,
    };
  } catch (error) {
    authSpinner?.fail();
    cleanup();

    throw new Error(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
