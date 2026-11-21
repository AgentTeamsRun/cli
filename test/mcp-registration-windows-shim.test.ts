import { describe, it, expect } from '@jest/globals';
import { resolveWindowsShimSpawn } from '../src/mcp-registration/windowsShim.js';

const cmdLine = (executable: string, args: string[]): string => {
  const resolved = resolveWindowsShimSpawn(executable, args, { ComSpec: 'cmd.exe' }, 'win32');
  expect(resolved.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
  return resolved.args[3];
};

describe('resolveWindowsShimSpawn .cmd escaping', () => {
  it('caret-escapes an embedded quote so a following & cannot become a command separator', () => {
    // `\"` is not an escape for cmd.exe: the old `"key=a\"b&c"` let cmd.exe run `c"` as a second command.
    expect(cmdLine('C:\\bin\\claude.cmd', ['key=a"b&c'])).toBe('"C:\\bin\\claude.cmd ^^^"key=a\\^^^"b^^^&c^^^""');
  });

  it('caret-escapes % so cmd.exe does not expand environment variables', () => {
    expect(cmdLine('C:\\bin\\claude.cmd', ['%PATH%'])).toBe('"C:\\bin\\claude.cmd ^^^"^^^%PATH^^^%^^^""');
  });

  it('doubles backslashes that precede a quote or the end of the argument', () => {
    expect(cmdLine('C:\\bin\\claude.cmd', ['C:\\dir\\', 'a\\"b'])).toBe(
      '"C:\\bin\\claude.cmd ^^^"C:\\dir\\\\^^^" ^^^"a\\\\\\^^^"b^^^""',
    );
  });

  it('escapes spaces in the shim path instead of quoting it', () => {
    expect(cmdLine('C:\\Users\\My Name\\bin\\codex.cmd', ['--version'])).toBe(
      '"C:\\Users\\My^ Name\\bin\\codex.cmd ^^^"--version^^^""',
    );
  });
});
