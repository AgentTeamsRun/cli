import { describe, it, expect, jest } from '@jest/globals';
import { assertMcpProjectBinding } from '../src/mcp/context.js';

const KMA_PROJECT_ID = '78a24ae4-1816-4a04-8466-809686af9113';
const AGENTTEAMS_PROJECT_ID = '118b8612-2343-424c-a8fb-fa97c618323c';

describe('mcp project binding', () => {
  it('rejects a user-scoped binding that differs from the local project before tools start', () => {
    expect(() =>
      assertMcpProjectBinding({
        localProjectId: KMA_PROJECT_ID,
        boundProjectId: AGENTTEAMS_PROJECT_ID,
        bindingSource: 'user',
      }),
    ).toThrow(/project binding mismatch/i);
  });

  it('accepts a matching project binding and an explicit Desktop binding', () => {
    expect(() =>
      assertMcpProjectBinding({
        localProjectId: KMA_PROJECT_ID,
        boundProjectId: KMA_PROJECT_ID,
        bindingSource: 'user',
      }),
    ).not.toThrow();
    expect(() =>
      assertMcpProjectBinding({
        localProjectId: AGENTTEAMS_PROJECT_ID,
        boundProjectId: KMA_PROJECT_ID,
        bindingSource: 'desktop',
      }),
    ).not.toThrow();
  });
});

// The config module is mocked so the credential-resolution contract is asserted
// independently of the machine's project/global `.agentteams/config.json`.
describe('mcp credential resolution', () => {
  it('rejects a bound project that differs from the raw repository config', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: () => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-agentteams',
        projectId: AGENTTEAMS_PROJECT_ID,
      }),
      loadProjectConfig: () => ({
        teamId: 'team-kma',
        projectId: KMA_PROJECT_ID,
        apiKey: 'key_local',
      }),
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    expect(() => resolveMcpToolContext({})).toThrow(/project binding mismatch/i);
  });

  it('accepts an explicit Desktop binding even when the Desktop process cwd belongs to another project', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: () => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-kma',
        projectId: KMA_PROJECT_ID,
      }),
      loadProjectConfig: () => ({
        teamId: 'team-agentteams',
        projectId: AGENTTEAMS_PROJECT_ID,
        apiKey: 'key_local',
      }),
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));
    const previousSource = process.env.AGENTTEAMS_MCP_BINDING_SOURCE;
    process.env.AGENTTEAMS_MCP_BINDING_SOURCE = 'desktop';

    try {
      const { resolveMcpToolContext } = await import('../src/commands/mcp.js');
      expect(resolveMcpToolContext({}).projectId).toBe(KMA_PROJECT_ID);
    } finally {
      if (previousSource === undefined) delete process.env.AGENTTEAMS_MCP_BINDING_SOURCE;
      else process.env.AGENTTEAMS_MCP_BINDING_SOURCE = previousSource;
    }
  });

  it('throws the configuration-not-found message when no credentials resolve', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: () => null,
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    expect(() => resolveMcpToolContext({})).toThrow('Configuration not found.');
  });

  it('passes CLI overrides through and normalizes the API URL', async () => {
    jest.resetModules();
    const loadConfig = jest.fn(() => ({
      apiUrl: 'http://localhost:3001/',
      apiKey: 'key_override',
      teamId: 'team-1',
      projectId: 'project-override',
    }));
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig,
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    const context = resolveMcpToolContext({
      apiKey: 'key_override',
      projectId: 'project-override',
      apiUrl: 'http://localhost:3001/',
      unrelated: 'ignored',
    });

    expect(loadConfig).toHaveBeenCalledWith({
      apiKey: 'key_override',
      projectId: 'project-override',
      apiUrl: 'http://localhost:3001/',
    });
    expect(context).toEqual({
      apiUrl: 'http://localhost:3001',
      projectId: 'project-override',
      headers: { 'X-API-Key': 'key_override', 'Content-Type': 'application/json' },
    });
  });

  // MCP clients substitute ${VAR} in their server config before spawning; when
  // that fails, the literal string satisfies loadConfig()'s "non-empty" check
  // and every later call would 401. Startup must reject it instead.
  it.each([
    ['apiKey', { apiKey: '${AGENTTEAMS_API_KEY}' }, 'AGENTTEAMS_API_KEY'],
    ['projectId', { projectId: '${AGENTTEAMS_PROJECT_ID}' }, 'AGENTTEAMS_PROJECT_ID'],
    ['teamId', { teamId: '${AGENTTEAMS_TEAM_ID}' }, 'AGENTTEAMS_TEAM_ID'],
  ])('rejects an unresolved ${...} placeholder in %s before serving', async (field, override, envHint) => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: (overrides: Record<string, string>) => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-1',
        projectId: 'project-1',
        ...overrides,
      }),
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    expect(() => resolveMcpToolContext(override)).toThrow(/Unresolved \$\{\.\.\.\} placeholder/);
    expect(() => resolveMcpToolContext(override)).toThrow(new RegExp(`${field} \\(${envHint}\\)`));
  });

  it('accepts credentials without placeholders', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: () => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-1',
        projectId: 'project-1',
      }),
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    expect(() => resolveMcpToolContext({})).not.toThrow();
  });
});
