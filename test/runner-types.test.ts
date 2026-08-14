import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RUNNER_TYPE_OPTION_DESCRIPTION, RUNNER_TYPE_VALUES } from '../src/utils/runnerTypes.js';

// `import.meta.url`을 쓰지 않는다 — 이 워크스페이스의 ts-jest 설정에서 TS1343으로 컴파일이
// 막히고, 같은 방식을 쓰는 test/mcp-registration-registry.test.ts가 그 때문에 실행되지 못하고 있다.
// Jest는 cli/ 루트를 cwd로 실행하므로 거기서 모노레포 루트를 올라간다.
const cliRoot = process.cwd();
const monorepoRoot = dirname(cliRoot);

describe('runner type mirror', () => {
  /**
   * The published CLI is a `cli/`-only subtree split, so `RUNNER_TYPES` cannot be a
   * runtime import. This monorepo-only test is what keeps the hand-written mirror from
   * drifting away from the SSOT — the drift this list already had (five values against
   * the SSOT's nine) is exactly what went unnoticed without it.
   */
  it('covers exactly the RUNNER_TYPES keys from packages/core-constants', () => {
    const constantsPath = join(monorepoRoot, 'packages', 'core-constants', 'index.js');
    expect(existsSync(constantsPath)).toBe(true);

    // core-constants는 순수 ESM이고 cli/ 루트 밖에 있어 Jest 리졸버로는 동적 import가 되지 않는다.
    // 드리프트 판정에 필요한 것은 키 집합뿐이므로 SSOT 선언을 그대로 읽어 키를 뽑는다.
    const source = readFileSync(constantsPath, 'utf-8');
    const declaration = /export const RUNNER_TYPES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);
    expect(declaration).not.toBeNull();

    const ssotKeys = [...(declaration?.[1] ?? '').matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
    expect(ssotKeys.length).toBeGreaterThan(0);

    expect([...RUNNER_TYPE_VALUES].sort()).toEqual(ssotKeys.sort());
  });

  it('excludes the deprecated GEMINI value', () => {
    expect(RUNNER_TYPE_VALUES).not.toContain('GEMINI');
  });

  it('advertises every supported runner type in the --runner-type help text', () => {
    for (const value of RUNNER_TYPE_VALUES) {
      expect(RUNNER_TYPE_OPTION_DESCRIPTION).toContain(value);
    }
  });
});
