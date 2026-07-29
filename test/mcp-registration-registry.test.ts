import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MCP_CLIENTS } from '../src/mcp-registration/clients.js';
import { runMcpConfigCommand } from '../src/mcp-registration/index.js';
import { MCP_CLIENT_IDS } from '../src/mcp-registration/types.js';
import type { McpCredentials } from '../src/mcp-registration/serverSpec.js';
import type { McpScope } from '../src/mcp-registration/types.js';

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const monorepoRoot = dirname(cliRoot);

const CANARY_API_KEY = 'key_canary_7f3c9d21e5b84a06_do_not_leak';

const credentials: McpCredentials = {
  apiKey: CANARY_API_KEY,
  projectId: 'project-fixture',
  teamId: 'team-fixture',
  apiUrl: 'https://api.agentteams.run',
};

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) {
        snapshot[fullPath] = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
      }
    }
  };
  walk(root);
  return snapshot;
}

describe('mcp client registry', () => {
  it('exposes exactly the eight supported clients and excludes Orca and GEMINI', () => {
    expect(MCP_CLIENTS.map((client) => client.id)).toEqual([...MCP_CLIENT_IDS]);
    expect(MCP_CLIENTS).toHaveLength(8);
    expect(MCP_CLIENT_IDS).not.toContain('orca');
    expect(MCP_CLIENTS.map((client) => client.runnerType)).not.toContain('GEMINI');
  });

  /**
   * The published CLI is a `cli/`-only subtree split, so `RUNNER_TYPES` cannot
   * be a runtime import. This monorepo-only test is what keeps the hand-written
   * registry from drifting away from the SSOT.
   */
  it('covers exactly the RUNNER_TYPES keys from packages/core-constants', async () => {
    const constantsPath = join(monorepoRoot, 'packages', 'core-constants', 'index.js');
    expect(existsSync(constantsPath)).toBe(true);

    const { RUNNER_TYPES } = (await import(pathToFileURL(constantsPath).href)) as {
      RUNNER_TYPES: Record<string, string>;
    };

    expect(MCP_CLIENTS.map((client) => client.runnerType).sort()).toEqual(Object.keys(RUNNER_TYPES).sort());
  });

  it('records an official documentation URL and a verification date for every client', () => {
    for (const client of MCP_CLIENTS) {
      expect(client.docsUrl).toMatch(/^https:\/\//);
      expect(client.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('declares a config path and a strategy for both scopes of every client', () => {
    const context = { homeDir: '/home/fixture', cwd: '/repo/fixture', env: {} as NodeJS.ProcessEnv };
    for (const client of MCP_CLIENTS) {
      for (const scope of ['user', 'project'] as McpScope[]) {
        const definition = client.scopes[scope];
        expect(definition.configPath(context)).toMatch(/^[/\\]/);
        expect(['vendorCommand', 'jsonMerge', 'configOnly']).toContain(definition.strategy);
        if (definition.strategy === 'vendorCommand') expect(definition.vendor).toBeDefined();
        if (definition.strategy === 'jsonMerge') expect(definition.containerKey).toBeDefined();
        if (definition.strategy === 'configOnly') expect(definition.configOnlyReason).toBeTruthy();
      }
    }
  });
});

describe('mcp config output', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentteams-mcp-config-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'agentteams-mcp-config-cwd-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  const run = (options: Record<string, unknown> = {}, context = { homeDir: home, cwd, env: {} as NodeJS.ProcessEnv }) =>
    runMcpConfigCommand(options, { credentials, context });

  it('defaults omitted scope to project', () => {
    const output = run() as { json: { scope: string; clients: { scope: string }[] } };

    expect(output.json.scope).toBe('project');
    expect(output.json.clients.every((client) => client.scope === 'project')).toBe(true);
  });

  it.each(['user', 'project'] as McpScope[])(
    'renders all three required environment variables for every client at %s scope',
    (scope) => {
      const output = run({ scope }) as { json: { clients: { clientId: string; snippet: string }[] } };

      expect(output.json.clients).toHaveLength(8);
      for (const client of output.json.clients) {
        expect(client.snippet).toContain('AGENTTEAMS_API_KEY');
        expect(client.snippet).toContain('AGENTTEAMS_PROJECT_ID');
        expect(client.snippet).toContain('AGENTTEAMS_TEAM_ID');
        expect(client.snippet).toContain('project-fixture');
        expect(client.snippet).toContain('team-fixture');
      }
    },
  );

  it('is deterministic for identical input', () => {
    expect(run({ scope: 'user' }).text).toEqual(run({ scope: 'user' }).text);
  });

  it('renders the documented snippet for each client at user scope', () => {
    const output = run({ scope: 'user' }) as {
      json: { clients: { clientId: string; snippet: string; configPath: string }[] };
    };
    const byId = Object.fromEntries(output.json.clients.map((client) => [client.clientId, client]));

    expect(byId['cursor-cli'].snippet).toEqual(
      [
        '{',
        '  "mcpServers": {',
        '    "agentteams": {',
        '      "command": "npx",',
        '      "args": [',
        '        "-y",',
        '        "@agentteams/cli",',
        '        "mcp"',
        '      ],',
        '      "env": {',
        '        "AGENTTEAMS_API_KEY": "${AGENTTEAMS_API_KEY}",',
        '        "AGENTTEAMS_PROJECT_ID": "project-fixture",',
        '        "AGENTTEAMS_TEAM_ID": "team-fixture"',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(byId['codex'].snippet).toEqual(
      [
        '[mcp_servers.agentteams]',
        'command = "npx"',
        'args = ["-y", "@agentteams/cli", "mcp"]',
        'env_vars = ["AGENTTEAMS_API_KEY"]',
        '',
        '[mcp_servers.agentteams.env]',
        'AGENTTEAMS_PROJECT_ID = "project-fixture"',
        'AGENTTEAMS_TEAM_ID = "team-fixture"',
      ].join('\n'),
    );

    // OpenCode uses `command` as an argv array plus `environment`, not `args`/`env`.
    expect(JSON.parse(byId['opencode'].snippet)).toEqual({
      mcp: {
        agentteams: {
          type: 'local',
          command: ['npx', '-y', '@agentteams/cli', 'mcp'],
          environment: {
            AGENTTEAMS_API_KEY: '{env:AGENTTEAMS_API_KEY}',
            AGENTTEAMS_PROJECT_ID: 'project-fixture',
            AGENTTEAMS_TEAM_ID: 'team-fixture',
          },
          enabled: true,
        },
      },
    });

    expect(JSON.parse(byId['amp'].snippet)).toHaveProperty(['amp.mcpServers', 'agentteams', 'command'], 'npx');
    expect(JSON.parse(byId['claude-code'].snippet)).toHaveProperty(['mcpServers', 'agentteams', 'type'], 'stdio');
  });

  it('uses CODEX_HOME and COPILOT_HOME for user config paths', () => {
    const codexHome = join(home, 'custom-codex');
    const copilotHome = join(home, 'custom-copilot');
    const context = {
      homeDir: home,
      cwd,
      env: { CODEX_HOME: codexHome, COPILOT_HOME: copilotHome } as NodeJS.ProcessEnv,
    };

    expect(run({ client: 'codex', scope: 'user' }, context).json).toMatchObject({
      clients: [{ configPath: join(codexHome, 'config.toml') }],
    });
    expect(run({ client: 'copilot-cli', scope: 'user' }, context).json).toMatchObject({
      clients: [{ configPath: join(copilotHome, 'mcp-config.json') }],
    });
  });

  it('uses the local entry point when --server-entry is given', () => {
    const output = run({ scope: 'user', client: 'cursor-cli', serverEntry: '/opt/agentteams/cli/dist/index.js' });
    expect(output.text).toContain('"command": "node"');
    expect(output.text).toContain('/opt/agentteams/cli/dist/index.js');
  });

  it('pins a non-default API URL and omits it otherwise', () => {
    const localOutput = runMcpConfigCommand(
      { scope: 'user', client: 'cursor-cli' },
      {
        credentials: { ...credentials, apiUrl: 'http://localhost:3001' },
        context: { homeDir: home, cwd, env: {} as NodeJS.ProcessEnv },
      },
    );
    expect(localOutput.text).toContain('AGENTTEAMS_API_URL');
    expect(run({ scope: 'user', client: 'cursor-cli' }).text).not.toContain('AGENTTEAMS_API_URL');
  });

  it('never prints the real API key', () => {
    for (const scope of ['user', 'project'] as McpScope[]) {
      const output = run({ scope });
      expect(output.text).not.toContain(CANARY_API_KEY);
      expect(JSON.stringify(output.json)).not.toContain(CANARY_API_KEY);
      expect(output.text).toContain('AGENTTEAMS_API_KEY');
    }
  });

  it('rejects unknown clients and scopes without producing output', () => {
    expect(() => run({ client: 'orca' })).toThrow(/Unknown client: orca/);
    expect(() => run({ client: 'gemini' })).toThrow(/Unknown client: gemini/);
    expect(() => run({ scope: 'global' })).toThrow(/Unsupported scope/);
  });

  it('renders a personal-login project without an API key instead of failing as unconfigured', () => {
    // `init --auth personal-token` writes no `apiKey`, so the old config loader
    // reported the project as uninitialized and `mcp config` refused to run.
    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    const projectRoot = mkdtempSync(join(tmpdir(), 'agentteams-mcp-personal-'));
    mkdirSync(join(projectRoot, '.agentteams'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.agentteams', 'config.json'),
      JSON.stringify({ teamId: 'team-personal', projectId: 'project-personal', authMode: 'personal-token' }),
      'utf-8',
    );

    try {
      // Environment overrides beat the project file, and a runner process has
      // these set; the fixture has to be the only source of truth here.
      for (const key of ['AGENTTEAMS_API_KEY', 'AGENTTEAMS_TEAM_ID', 'AGENTTEAMS_PROJECT_ID', 'AGENTTEAMS_API_URL']) {
        delete process.env[key];
      }
      process.chdir(projectRoot);

      const output = runMcpConfigCommand(
        { scope: 'user', client: 'cursor-cli' },
        { context: { homeDir: home, cwd: projectRoot, env: {} as NodeJS.ProcessEnv } },
      );

      expect(output.text).toContain('project-personal');
      // A 15-minute access token in a client config would break within the hour,
      // and a `${AGENTTEAMS_API_KEY}` reference nobody exports would only mask
      // the credential the server can resolve for itself.
      expect(output.text).not.toContain('AGENTTEAMS_API_KEY');
      expect(output.text).toContain('personal login');
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not create or modify any file', () => {
    // Seed both trees so the comparison covers "modified", not just "created".
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), '{ "mcpServers": {} }\n', 'utf-8');
    writeFileSync(join(cwd, 'opencode.json'), '{}\n', 'utf-8');

    const before = { ...snapshotTree(home), ...snapshotTree(cwd) };
    for (const scope of ['user', 'project'] as McpScope[]) {
      for (const clientId of MCP_CLIENT_IDS) run({ scope, client: clientId });
    }
    const after = { ...snapshotTree(home), ...snapshotTree(cwd) };

    expect(after).toEqual(before);
  });
});
