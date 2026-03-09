import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { multiselect, isCancel, cancel } from '@clack/prompts';
import httpClient from '../utils/httpClient.js';
import open from 'open';
import { startLocalAuthServer } from '../utils/authServer.js';
import { saveConfig } from '../utils/config.js';
import { createSpinner, withSpinner } from '../utils/spinner.js';
import { conventionDownload } from './convention.js';
import type { Config } from '../types/index.js';

const AUTH_BASE_URL = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';

const AGENT_ENTRY_POINT_FILES = [
  { value: 'CLAUDE.md',                    label: 'CLAUDE.md',                    hint: 'Claude Code' },
  { value: 'AGENTS.md',                    label: 'AGENTS.md',                    hint: 'OpenCode / Codex' },
  { value: 'GEMINI.md',                    label: 'GEMINI.md',                    hint: 'Antigravity' },
  { value: '.cursor/rules/agentteams.mdc', label: '.cursor/rules/agentteams.mdc', hint: 'Cursor' },
] as const;
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const CONVENTION_FILE = 'convention.md';

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

type InitResult = {
  success: true;
  authUrl: string;
  configPath: string;
  conventionPath: string;
  teamId: string;
  projectId: string;
  agentName: string;
  agentFiles: AgentFileEntry[];
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

export function buildAuthorizeUrl(port: number, projectName: string, authPathEnc?: string, osType?: string): string {
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

function toConfig(authResult: {
  teamId: string;
  projectId: string;
  repositoryId: string;
  agentName: string;
  apiKey: string;
  apiUrl: string;
}): Config {
  return {
    teamId: authResult.teamId,
    projectId: authResult.projectId,
    agentName: authResult.agentName,
    apiKey: authResult.apiKey,
    apiUrl: authResult.apiUrl,
    repositoryId: authResult.repositoryId,
  };
}

async function fetchConventionTemplate(authResult: {
  projectId: string;
  apiKey: string;
  apiUrl: string;
  configId: string;
}): Promise<string> {
  const apiUrl = authResult.apiUrl.endsWith('/')
    ? authResult.apiUrl.slice(0, -1)
    : authResult.apiUrl;

  const response = await httpClient.get(
    `${apiUrl}/api/projects/${authResult.projectId}/agent-configs/${authResult.configId}/convention`,
    {
      headers: {
        'X-API-Key': authResult.apiKey,
        'Content-Type': 'application/json',
      },
    }
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
  const entry = '.agentteams/';

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

function generateAgentEntryPointFiles(cwd: string, selectedFiles: string[]): AgentFileEntry[] {
  if (selectedFiles.length === 0) {
    return [];
  }

  const DEFAULT_CONVENTION_REFERENCE = `---
alwaysApply: true
---

# AGENT_RULES

**Before starting any task, always refer to \`.agentteams/convention.md\`.**
`;

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

export async function executeInitCommand(options?: InitOptions): Promise<InitResult> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
  const conventionPath = join(cwd, CONFIG_DIR, CONVENTION_FILE);

  const projectName = basename(cwd);

  let authContext;

  try {
    authContext = startLocalAuthServer();
  } catch (error) {
    throw new Error(
      `Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let authPathEnc: string | undefined;
  try {
    authPathEnc = encryptAuthPath(cwd);
  } catch {
    authPathEnc = undefined;
  }

  const authUrl = buildAuthorizeUrl(authContext.port, projectName, authPathEnc, detectOsType());
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

      authContext.waitForCallback().then((result) => {
        process.removeListener('SIGINT', onSigint);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeAllListeners('data');
        }
        resolve(result);
      }).catch(reject);
    });

    authSpinner?.succeed();
    const config = toConfig(authResult);
    const conventionContent = await withSpinner(
      'Fetching convention template...',
      () => fetchConventionTemplate(authResult),
    );

    saveConfig(configPath, config);
    writeFileSync(conventionPath, conventionContent, 'utf-8');
    await conventionDownload({ cwd, config });
    ensureGitignore(cwd);
    const selectedFiles = await promptAgentFileSelection();
    const agentFiles = generateAgentEntryPointFiles(cwd, selectedFiles);

    return {
      success: true,
      authUrl,
      configPath,
      conventionPath,
      teamId: authResult.teamId,
      projectId: authResult.projectId,
      agentName: authResult.agentName,
      agentFiles,
    };
  } catch (error) {
    authSpinner?.fail();
    cleanup();

    throw new Error(
      `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
