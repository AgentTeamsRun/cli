import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { CommanderError, type Command } from 'commander';
import { createProgram } from '../src/program/index.js';
import { removedContractHint } from '../src/program/shared.js';

/** configureOutput은 그대로 두고 종료만 가로챕니다(힌트 경로를 실제로 태우기 위해서). */
function exitOverrideDeep(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) exitOverrideDeep(child);
}

async function stderrOf(args: string[]): Promise<string> {
  const program = createProgram('0.0.0');
  exitOverrideDeep(program);
  let stderr = '';
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(['node', 'agentteams', ...args], { from: 'node' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
  } finally {
    spy.mockRestore();
  }
  return stderr;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('removedContractHint', () => {
  it.each([
    ["error: unknown option '--format'", '--format only exists on init, auth, sync, and doctor'],
    ["error: unknown option '--api-key'", 'Use --api-key-file <path>'],
    ["error: unknown option '--team-id'", 'AGENTTEAMS_TEAM_ID'],
    ["error: unknown option '--limit'", 'Use --page-size.'],
    ["error: unknown command 'show'", "Use 'get'."],
  ])('%s에 대체 수단을 안내한다', (message, expected) => {
    expect(removedContractHint(message)).toContain(expected);
  });

  it('제거 대상이 아닌 인자에는 힌트를 붙이지 않는다', () => {
    expect(removedContractHint("error: unknown option '--html-file'")).toBeUndefined();
    expect(removedContractHint("error: unknown command 'nope'")).toBeUndefined();
  });
});

describe('제거된 인자의 실제 실패 출력', () => {
  it('--format 실패에 마이그레이션 힌트를 덧붙인다', async () => {
    const stderr = await stderrOf(['plan', 'get', '--id', 'x', '--format', 'json']);
    expect(stderr).toContain("unknown option '--format'");
    expect(stderr).toContain('hint: --format only exists on init, auth, sync, and doctor');
  });

  it('제거된 show 별칭 실패에 get을 안내한다', async () => {
    const stderr = await stderrOf(['plan', 'show', '--id', 'x']);
    expect(stderr).toContain("unknown command 'show'");
    expect(stderr).toContain("hint: The 'show' alias was removed. Use 'get'.");
  });

  it('제거 대상이 아닌 실패에는 힌트를 붙이지 않는다', async () => {
    const stderr = await stderrOf(['plan', 'list', '--html-file', 'x']);
    expect(stderr).toContain("unknown option '--html-file'");
    expect(stderr).not.toContain('hint:');
  });
});
