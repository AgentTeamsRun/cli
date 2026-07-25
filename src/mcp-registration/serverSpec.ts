import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_API_URL } from '../utils/config.js';
import type { McpServerSpec } from './types.js';

/** Server name registered in every client. Kept stable so re-runs update rather than duplicate. */
export const MCP_SERVER_NAME = 'agentteams';

export const CREDENTIAL_ENV_KEYS = {
  apiKey: 'AGENTTEAMS_API_KEY',
  projectId: 'AGENTTEAMS_PROJECT_ID',
  teamId: 'AGENTTEAMS_TEAM_ID',
  apiUrl: 'AGENTTEAMS_API_URL',
} as const;

export interface McpCredentials {
  apiKey: string;
  projectId: string;
  teamId: string;
  apiUrl: string;
}

/**
 * `literal` writes the real API key into the client's own config file — only
 * ever used for user-scope `install`, where the file lives outside the repo and
 * is chmod 0600. Everything a human can read (`config` output, dry-run plans,
 * project-scope files that get committed) uses `reference`. The renderer then
 * converts that marker to each client's supported inheritance syntax.
 */
export type SecretMode = 'literal' | 'reference';

export interface BuildServerSpecOptions {
  credentials: McpCredentials;
  secretMode: SecretMode;
  /** Absolute path to a local `cli/dist/index.js`; omit to use the published package. */
  serverEntry?: string;
}

export function buildServerSpec(options: BuildServerSpecOptions): McpServerSpec {
  const { credentials, secretMode, serverEntry } = options;

  const env: Record<string, string> = {
    [CREDENTIAL_ENV_KEYS.apiKey]: secretMode === 'literal' ? credentials.apiKey : `\${${CREDENTIAL_ENV_KEYS.apiKey}}`,
    [CREDENTIAL_ENV_KEYS.projectId]: credentials.projectId,
    [CREDENTIAL_ENV_KEYS.teamId]: credentials.teamId,
  };

  // Only non-default API URLs are worth pinning; emitting the default would make
  // every generated config break the day the hosted URL changes.
  if (credentials.apiUrl && credentials.apiUrl !== DEFAULT_API_URL) {
    env[CREDENTIAL_ENV_KEYS.apiUrl] = credentials.apiUrl;
  }

  if (serverEntry) {
    const entryPath = isAbsolute(serverEntry) ? serverEntry : resolve(serverEntry);
    return { command: 'node', args: [entryPath, 'mcp'], env };
  }

  return { command: 'npx', args: ['-y', '@agentteams/cli', 'mcp'], env };
}
