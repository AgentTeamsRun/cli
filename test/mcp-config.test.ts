import { describe, it, expect, jest } from '@jest/globals';

// The config module is mocked so the credential-resolution contract is asserted
// independently of the machine's project/global `.agentteams/config.json`.
describe('mcp credential resolution', () => {
  it('throws the configuration-not-found message when no credentials resolve', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfig: () => null,
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
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    expect(() => resolveMcpToolContext({})).not.toThrow();
  });
});
