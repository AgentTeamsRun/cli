import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { loadConfig } from '../src/utils/config.js';

describe('Environment and Config Loading', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTTEAMS_API_KEY;
    delete process.env.AGENTTEAMS_API_URL;
    delete process.env.AGENTTEAMS_TEAM_ID;
    delete process.env.AGENTTEAMS_PROJECT_ID;
    delete process.env.AGENTTEAMS_AGENT_NAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should prioritize environment variables over file config values', () => {
    process.env.AGENTTEAMS_API_KEY = 'key_from_env';
    process.env.AGENTTEAMS_API_URL = 'https://env.example.com';
    process.env.AGENTTEAMS_TEAM_ID = 'team_from_env';
    process.env.AGENTTEAMS_PROJECT_ID = 'project_from_env';
    process.env.AGENTTEAMS_AGENT_NAME = 'agent_from_env';

    const config = loadConfig();

    expect(config).toEqual(
      expect.objectContaining({
        apiKey: 'key_from_env',
        apiUrl: 'https://env.example.com',
        teamId: 'team_from_env',
        projectId: 'project_from_env',
        agentName: 'agent_from_env',
      }),
    );
  });

  it('should load config from environment variables when all required fields exist', () => {
    process.env.AGENTTEAMS_API_KEY = 'key_test123';
    process.env.AGENTTEAMS_API_URL = 'http://localhost:3001';
    process.env.AGENTTEAMS_TEAM_ID = 'team_1';
    process.env.AGENTTEAMS_PROJECT_ID = 'project_1';
    process.env.AGENTTEAMS_AGENT_NAME = 'agent-a';

    const config = loadConfig();

    expect(config).toEqual(
      expect.objectContaining({
        apiKey: 'key_test123',
        apiUrl: 'http://localhost:3001',
        teamId: 'team_1',
        projectId: 'project_1',
        agentName: 'agent-a',
      }),
    );
  });
});
