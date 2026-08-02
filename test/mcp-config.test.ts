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
      loadConfigWithCredential: async () => ({
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
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    await expect(resolveMcpToolContext({})).rejects.toThrow(/project binding mismatch/i);
  });

  it('accepts an explicit Desktop binding even when the Desktop process cwd belongs to another project', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfigWithCredential: async () => ({
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
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));
    const previousSource = process.env.AGENTTEAMS_MCP_BINDING_SOURCE;
    process.env.AGENTTEAMS_MCP_BINDING_SOURCE = 'desktop';

    try {
      const { resolveMcpToolContext } = await import('../src/commands/mcp.js');
      expect((await resolveMcpToolContext({})).projectId).toBe(KMA_PROJECT_ID);
    } finally {
      if (previousSource === undefined) delete process.env.AGENTTEAMS_MCP_BINDING_SOURCE;
      else process.env.AGENTTEAMS_MCP_BINDING_SOURCE = previousSource;
    }
  });

  it('throws the configuration-not-found message when no credentials resolve', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfigWithCredential: async () => null,
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    await expect(resolveMcpToolContext({})).rejects.toThrow('Configuration not found.');
  });

  it('passes CLI overrides through and normalizes the API URL', async () => {
    jest.resetModules();
    const loadConfigWithCredential = jest.fn(async () => ({
      apiUrl: 'http://localhost:3001/',
      apiKey: 'key_override',
      teamId: 'team-1',
      projectId: 'project-override',
    }));
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfigWithCredential,
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    // 도구 축은 환경변수에서 온다. 러너 안에서 테스트를 돌리면 부모 프로세스의 값이
    // 새어 들어오므로, 여기서는 부재를 명시적으로 만들어 결과를 결정적으로 고정한다.
    const previousAgentName = process.env.AGENTTEAMS_AGENT_NAME;
    delete process.env.AGENTTEAMS_AGENT_NAME;

    try {
      const context = await resolveMcpToolContext({
        apiKey: 'key_override',
        projectId: 'project-override',
        apiUrl: 'http://localhost:3001/',
        unrelated: 'ignored',
      });

      expect(loadConfigWithCredential).toHaveBeenCalledWith({
        apiKey: 'key_override',
        projectId: 'project-override',
        apiUrl: 'http://localhost:3001/',
      });
      expect(context).toEqual({
        apiUrl: 'http://localhost:3001',
        projectId: 'project-override',
        headers: { 'X-API-Key': 'key_override', 'Content-Type': 'application/json' },
      });
      expect(context.agentConfigId).toBeUndefined();

      process.env.AGENTTEAMS_AGENT_NAME = 'agent-config-1';
      const daemonContext = await resolveMcpToolContext({
        apiKey: 'key_override',
        projectId: 'project-override',
        apiUrl: 'http://localhost:3001/',
      });
      expect(daemonContext.agentConfigId).toBe('agent-config-1');
    } finally {
      if (previousAgentName === undefined) delete process.env.AGENTTEAMS_AGENT_NAME;
      else process.env.AGENTTEAMS_AGENT_NAME = previousAgentName;
    }
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
      loadConfigWithCredential: async (overrides: Record<string, string>) => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-1',
        projectId: 'project-1',
        ...overrides,
      }),
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    await expect(resolveMcpToolContext(override)).rejects.toThrow(/Unresolved \$\{\.\.\.\} placeholder/);
    await expect(resolveMcpToolContext(override)).rejects.toThrow(new RegExp(`${field} \\(${envHint}\\)`));
  });

  it('accepts credentials without placeholders', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/utils/config.js', () => ({
      __esModule: true,
      loadConfigWithCredential: async () => ({
        apiUrl: 'http://localhost:3001',
        apiKey: 'key_valid',
        teamId: 'team-1',
        projectId: 'project-1',
      }),
      loadProjectConfig: () => null,
      getConfigurationNotFoundMessage: () => 'Configuration not found.',
      // writeTools -> guides.ts로 이어지는 정적 import. 이 키가 없으면 모듈 링크 자체가 깨진다.
      findProjectConfig: () => null,
    }));

    const { resolveMcpToolContext } = await import('../src/commands/mcp.js');

    await expect(resolveMcpToolContext({})).resolves.toBeDefined();
  });
});
