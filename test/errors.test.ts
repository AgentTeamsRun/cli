import { describe, expect, it } from '@jest/globals';
import { AxiosError } from 'axios';
import { attachErrorContext, handleError } from '../src/utils/errors.js';

function makeAxiosError(
  status: number,
  data?: { message?: string; errorCode?: string; minimumVersion?: string },
): AxiosError {
  return new AxiosError(data?.message ?? `HTTP ${status}`, undefined, undefined, undefined, {
    status,
    statusText: 'error',
    headers: {},
    config: { headers: {} } as any,
    data,
  });
}

describe('errors', () => {
  it('maps 400 errors and validation errors to guided messages', () => {
    expect(handleError(makeAxiosError(400, { message: 'bad input' }))).toContain('Bad request');
    expect(handleError(makeAxiosError(400, { message: 'field missing', errorCode: 'VALIDATION_ERROR' }))).toContain(
      'Bad request (validation).',
    );
  });

  it('maps 401 errors for invalid keys and auth-required cases', () => {
    expect(handleError(makeAxiosError(401, { message: 'unauthorized' }))).toContain('Invalid API key');
    expect(
      handleError(makeAxiosError(401, { message: '인증 토큰이 필요합니다', errorCode: 'AUTH_REQUIRED' })),
    ).toContain('Authentication required.');
  });

  it('maps 403 variants including translated Korean messages', () => {
    expect(
      handleError(makeAxiosError(403, { message: 'cross project', errorCode: 'CROSS_PROJECT_ACCESS_DENIED' })),
    ).toContain('Cross-project access denied');
    expect(
      handleError(
        makeAxiosError(403, { message: '컨벤션 수정 권한이 없습니다', errorCode: 'CONVENTION_WRITE_FORBIDDEN' }),
      ),
    ).toContain("You don't have permission to modify conventions.");
    expect(
      handleError(
        makeAxiosError(403, { message: '프로젝트 접근 권한이 없습니다', errorCode: 'PROJECT_ACCESS_FORBIDDEN' }),
      ),
    ).toContain("You don't have permission to access this project.");
    expect(handleError(makeAxiosError(403, { message: 'plain forbidden' }))).toContain('Forbidden.');
  });

  it('maps 404, 409, and 500 status codes', () => {
    expect(handleError(makeAxiosError(404, { message: 'missing' }))).toContain('Resource not found.');
    expect(handleError(makeAxiosError(409, { message: 'collision' }))).toContain('Conflict.');
    expect(handleError(makeAxiosError(409, { message: 'stale', errorCode: 'OPTIMISTIC_LOCK_CONFLICT' }))).toContain(
      'Conflict (stale update).',
    );
    expect(handleError(makeAxiosError(500, { message: 'boom' }))).toContain('Server error occurred.');
  });

  it('maps 426 / CLI_UPGRADE_REQUIRED to a friendly upgrade guide', () => {
    const result = handleError(
      makeAxiosError(426, {
        message: 'CLI version 0.0.10 is no longer supported. Please upgrade: npm install -g @agentteams/cli',
        errorCode: 'CLI_UPGRADE_REQUIRED',
        minimumVersion: '0.0.20',
      }),
    );

    expect(result).not.toContain('HTTP 426 error');
    expect(result).toContain('Your AgentTeams CLI version is no longer supported.');
    expect(result).toContain('npm install -g @agentteams/cli@latest');
    expect(result).toContain('agentteams --version');
    expect(result).toContain('which -a agentteams');
    expect(result).toContain('Minimum supported version: 0.0.20');
    expect(result).toContain(
      'Details: CLI version 0.0.10 is no longer supported. Please upgrade: npm install -g @agentteams/cli',
    );
  });

  it('handles plain 426 without errorCode or minimumVersion', () => {
    const result = handleError(makeAxiosError(426, { message: 'upgrade required' }));

    expect(result).not.toContain('HTTP 426 error');
    expect(result).toContain('Your AgentTeams CLI version is no longer supported.');
    expect(result).toContain('npm install -g @agentteams/cli@latest');
    expect(result).not.toContain('Minimum supported version:');
    expect(result).toContain('Details: upgrade required');
  });

  it('handles CLI_UPGRADE_REQUIRED errorCode with a non-426 status', () => {
    const result = handleError(
      makeAxiosError(200, {
        message: 'CLI version 0.0.10 is no longer supported.',
        errorCode: 'CLI_UPGRADE_REQUIRED',
        minimumVersion: '0.0.20',
      }),
    );

    expect(result).toContain('Your AgentTeams CLI version is no longer supported.');
    expect(result).toContain('Minimum supported version: 0.0.20');
  });

  it('handles connection, generic Error, and non-Error values', () => {
    process.env.AGENTTEAMS_API_URL = 'https://api.example';

    const networkError = new AxiosError('connect fail');
    networkError.code = 'ECONNREFUSED';

    expect(handleError(networkError)).toContain('Cannot connect to server at https://api.example.');
    expect(handleError(new Error('plain error'))).toBe('plain error');
    expect(handleError(123)).toBe('123');
  });

  it('prefers resolved apiUrl from error context for connection failures', () => {
    process.env.AGENTTEAMS_API_URL = '';

    const networkError = new AxiosError('connect fail');
    networkError.code = 'ENOTFOUND';

    attachErrorContext(networkError, { apiUrl: 'https://resolved.example' });

    expect(handleError(networkError)).toBe(
      'Cannot connect to server at https://resolved.example.\nNext: Check network connectivity and firewall settings.',
    );
  });

  it('shows configuration guidance when apiUrl is unavailable', () => {
    process.env.AGENTTEAMS_API_URL = '';

    const networkError = new AxiosError('connect fail');
    networkError.code = 'ECONNREFUSED';

    expect(handleError(networkError)).toBe(
      "Cannot connect to server (API URL not configured).\nNext: Run 'agentteams init' or set AGENTTEAMS_API_URL.",
    );
  });
});
