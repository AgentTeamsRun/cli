import { describe, it, expect } from '@jest/globals';
import {
  FAST_MODE_ENV,
  MODEL_ENV,
  RUNNER_TYPE_ENV,
  resolveExecutionSnapshot,
  resolveSessionFastMode,
  resolveSessionModel,
  resolveSessionRunnerType,
} from '../src/utils/agentIdentity.js';

const runnerSessionEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  [RUNNER_TYPE_ENV]: 'CODEX',
  [MODEL_ENV]: 'gpt-5-codex',
  ...overrides,
});

describe('execution snapshot resolution', () => {
  it('falls back to the runner session environment when no argument is given', () => {
    const snapshot = resolveExecutionSnapshot({}, runnerSessionEnv({ [FAST_MODE_ENV]: 'true' }));

    expect(snapshot).toEqual({ runnerType: 'CODEX', model: 'gpt-5-codex', fastMode: true });
  });

  it('lets an explicit argument win over the environment', () => {
    const snapshot = resolveExecutionSnapshot(
      { runnerType: 'CLAUDE_CODE', model: 'claude-opus-5' },
      runnerSessionEnv(),
    );

    expect(snapshot.runnerType).toBe('CLAUDE_CODE');
    expect(snapshot.model).toBe('claude-opus-5');
  });

  it('resolves to undefined outside a runner session so callers keep failing', () => {
    const snapshot = resolveExecutionSnapshot({}, {});

    expect(snapshot.runnerType).toBeUndefined();
    expect(snapshot.model).toBeUndefined();
    expect(snapshot.fastMode).toBe(false);
  });

  it('treats blank and whitespace-only variables as absent rather than as values', () => {
    const snapshot = resolveExecutionSnapshot({}, { [RUNNER_TYPE_ENV]: '', [MODEL_ENV]: '   ' });

    expect(snapshot.runnerType).toBeUndefined();
    expect(snapshot.model).toBeUndefined();
  });

  it('turns fast mode on from either the flag or the environment', () => {
    expect(resolveExecutionSnapshot({ fast: true }, {}).fastMode).toBe(true);
    expect(resolveExecutionSnapshot({}, { [FAST_MODE_ENV]: 'true' }).fastMode).toBe(true);
    expect(resolveExecutionSnapshot({ fast: false }, { [FAST_MODE_ENV]: 'true' }).fastMode).toBe(true);
  });

  it('does not read a non-"true" fast mode value as on', () => {
    // 데몬은 fast mode가 켜졌을 때만 변수를 내보내므로, 그 밖의 값은 신뢰하지 않는다.
    expect(resolveSessionFastMode({ [FAST_MODE_ENV]: 'false' })).toBe(false);
    expect(resolveSessionFastMode({ [FAST_MODE_ENV]: '1' })).toBe(false);
    expect(resolveSessionFastMode({})).toBe(false);
  });

  it('exposes single-axis resolvers that read the daemon variable names', () => {
    expect(resolveSessionRunnerType({ [RUNNER_TYPE_ENV]: 'KIRO_CLI' })).toBe('KIRO_CLI');
    expect(resolveSessionModel({ [MODEL_ENV]: 'k3' })).toBe('k3');
  });

  it('names exactly the variables the daemon exports', () => {
    // daemon/src/runners/session-env.ts와 한 글자라도 어긋나면 폴백이 조용히 끊긴다.
    expect(RUNNER_TYPE_ENV).toBe('AGENTTEAMS_RUNNER_TYPE');
    expect(MODEL_ENV).toBe('AGENTTEAMS_MODEL');
    expect(FAST_MODE_ENV).toBe('AGENTTEAMS_FAST_MODE');
  });
});
