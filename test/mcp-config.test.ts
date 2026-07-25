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
});
