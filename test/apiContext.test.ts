import { describe, expect, it } from '@jest/globals';
import { buildAuthHeaders, resolveApiContext } from '../src/utils/apiContext.js';
import type { Config } from '../src/types/index.js';

const config = (apiKey: string): Config =>
  ({
    apiKey,
    apiUrl: 'https://api.example.test/',
    teamId: 'team-1',
    projectId: 'project-1',
  }) as Config;

describe('credential kind decides the auth header', () => {
  it('sends an agent API key on X-API-Key', () => {
    expect(buildAuthHeaders('key_cfg_secret')).toEqual({ 'X-API-Key': 'key_cfg_secret' });
  });

  it('sends a desktop personal access token as a bearer token', () => {
    // The server gates X-API-Key on the key_ prefix and 401s anything else before
    // looking it up, so a personal token sent that way always reads as "Invalid API key".
    expect(buildAuthHeaders('atp_personal_secret')).toEqual({ Authorization: 'Bearer atp_personal_secret' });
  });

  it('keeps the trailing-slash trim and content type', () => {
    expect(resolveApiContext(config('key_cfg_secret'))).toEqual({
      apiUrl: 'https://api.example.test',
      headers: { 'X-API-Key': 'key_cfg_secret', 'Content-Type': 'application/json' },
    });
    expect(resolveApiContext(config('atp_personal_secret')).headers).toEqual({
      Authorization: 'Bearer atp_personal_secret',
      'Content-Type': 'application/json',
    });
  });
});
