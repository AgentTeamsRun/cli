import { describe, it, expect, beforeAll } from '@jest/globals';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distEntry = join(cliRoot, 'dist', 'index.js');

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

/**
 * stdout purity has to be checked on the real entry point — the commander
 * action, `startMcpServer()` and the SDK's own `StdioServerTransport` — because
 * that is where a stray `console.log`, spinner or update banner would break a
 * client's JSON-RPC framing. The in-process tests in mcp.test.ts exercise the
 * protocol but never touch those layers.
 */
function runMcpSession(requests: Record<string, unknown>[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry, 'mcp'], {
      // A temp cwd plus explicit credentials keeps the run independent of any
      // .agentteams/config.json that happens to sit near the checkout.
      cwd: tmpdir(),
      env: {
        ...process.env,
        AGENTTEAMS_API_URL: 'http://127.0.0.1:1',
        AGENTTEAMS_API_KEY: 'key_smoke_test',
        AGENTTEAMS_TEAM_ID: 'team-smoke',
        AGENTTEAMS_PROJECT_ID: 'project-smoke',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }

    const timer = setTimeout(() => child.kill('SIGTERM'), 4_000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}

function parseStdoutLines(stdout: string): { messages: Record<string, any>[]; nonJson: string[] } {
  const messages: Record<string, any>[] = [];
  const nonJson: string[] = [];

  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const message = JSON.parse(line);
      if (message?.jsonrpc === '2.0') messages.push(message);
      else nonJson.push(line);
    } catch {
      nonJson.push(line);
    }
  }

  return { messages, nonJson };
}

describe('agentteams mcp — built CLI entry point', () => {
  beforeAll(() => {
    // Built here rather than assumed present, so the smoke runs in CI (which has
    // no build step) exactly as it does locally.
    execFileSync(process.execPath, [join(cliRoot, 'node_modules', 'typescript', 'bin', 'tsc')], {
      cwd: cliRoot,
      stdio: 'inherit',
    });
    expect(existsSync(distEntry)).toBe(true);
  }, 120_000);

  it('emits only JSON-RPC on stdout and keeps diagnostics on stderr', async () => {
    const { stdout, stderr } = await runMcpSession([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '0.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'server/discover', params: { _meta: MODERN_META } },
    ]);

    const { messages, nonJson } = parseStdoutLines(stdout);

    expect(nonJson).toEqual([]);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.map((message) => message.id)).toEqual(expect.arrayContaining([1, 2]));

    const tools = messages.find((message) => message.id === 2)?.result?.tools ?? [];
    expect(tools.map((tool: { name: string }) => tool.name)).toContain('agentteams_search');

    // Diagnostics must exist, and must exist only on stderr.
    expect(stderr).toContain('[agentteams mcp]');
    expect(stdout).not.toContain('[agentteams mcp]');
  }, 60_000);

  it('exits non-zero without writing to stdout when credentials are missing', async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      // An empty HOME as well as an empty cwd: otherwise a developer's global
      // ~/.agentteams/config.json would satisfy loadConfig() and the server
      // would start, failing this test for reasons unrelated to the code.
      const emptyHome = mkdtempSync(join(tmpdir(), 'agentteams-mcp-home-'));
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome };
      delete env.AGENTTEAMS_API_KEY;
      delete env.AGENTTEAMS_TEAM_ID;
      delete env.AGENTTEAMS_PROJECT_ID;
      delete env.AGENTTEAMS_API_URL;

      const child = spawn(process.execPath, [distEntry, 'mcp'], {
        cwd: tmpdir(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Configuration not found');
  }, 60_000);
});
