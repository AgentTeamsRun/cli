import { describe, it, expect } from '@jest/globals';
import { CANONICAL_CLI_NAME, resolveInvokedName } from '../src/program/invokedName.js';
import { createProgram } from '../src/program/index.js';

/** `process.argv[1]`을 잠시 바꿔 실행하고 원복한다. 전역 상태이므로 케이스마다 반드시 복원한다. */
function withArgv1<T>(value: string, run: () => T): T {
  const original = process.argv[1];
  try {
    process.argv[1] = value;
    return run();
  } finally {
    process.argv[1] = original;
  }
}

describe('resolveInvokedName', () => {
  it('keeps the alias when it is invoked as agt', () => {
    expect(resolveInvokedName('agt')).toBe('agt');
  });

  it('keeps the canonical name when it is invoked as agentteams', () => {
    expect(resolveInvokedName('agentteams')).toBe(CANONICAL_CLI_NAME);
  });

  it('falls back to the canonical name for anything outside the whitelist', () => {
    expect(resolveInvokedName('jest.js')).toBe(CANONICAL_CLI_NAME);
    expect(resolveInvokedName('')).toBe(CANONICAL_CLI_NAME);
    expect(resolveInvokedName('agentteams-old')).toBe(CANONICAL_CLI_NAME);
  });

  it('falls back to the canonical name for shim entry points that pass the real script path', () => {
    // Windows `agt.cmd`/`agt.ps1`와 pnpm 전역 래퍼는 심링크가 아니라 `node "<...>\dist\index.js"`를
    // 실행하므로 argv[1]에는 항상 진입 스크립트가 들어온다. 폴백이 의도된 동작임을 고정한다.
    expect(
      resolveInvokedName('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentteams\\cli\\dist\\index.js'),
    ).toBe(CANONICAL_CLI_NAME);
    expect(resolveInvokedName('index.js')).toBe(CANONICAL_CLI_NAME);
  });

  it('resolves from process.argv[1] by default', () => {
    withArgv1('/usr/local/bin/agt', () => expect(resolveInvokedName()).toBe('agt'));
    withArgv1('/usr/local/lib/node_modules/@agentteams/cli/dist/index.js', () =>
      expect(resolveInvokedName()).toBe(CANONICAL_CLI_NAME),
    );
  });
});

describe('createProgram', () => {
  it('names the program after the invoked binary', () => {
    withArgv1('/usr/local/bin/agt', () => expect(createProgram('0.0.0').name()).toBe('agt'));
  });

  it('names the program agentteams when the runner file name is not a known alias', () => {
    withArgv1('/usr/local/lib/node_modules/@agentteams/cli/dist/index.js', () =>
      expect(createProgram('0.0.0').name()).toBe(CANONICAL_CLI_NAME),
    );
  });

  it('uses the explicitly injected name instead of process.argv[1]', () => {
    // 도움말 baseline 테스트가 실행 진입점과 무관하게 정식 이름을 고정할 수 있어야 한다.
    withArgv1('/usr/local/bin/agt', () =>
      expect(createProgram('0.0.0', CANONICAL_CLI_NAME).name()).toBe(CANONICAL_CLI_NAME),
    );
  });
});
