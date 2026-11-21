import { extname } from 'node:path';

export interface ResolvedSpawnSpec {
  executable: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

// cmd.exe metacharacters, including `"` and `%`. Quoting alone is not enough:
// cmd.exe does not treat `\"` as an escape, so an embedded quote flips its quote
// state and exposes a following `&` as a command separator, and `%VAR%` expands
// even inside quotes. Caret-escaping every metacharacter keeps cmd.exe from
// interpreting any of them (same scheme as cross-spawn).
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdCommand(value: string): string {
  return value.replace(CMD_META_CHARS, '^$1');
}

function escapeCmdArgument(value: string): string {
  // First quote for CommandLineToArgvW, which the target process uses to split
  // its command line: backslashes before a quote and at the end are doubled.
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  // Escaped twice: vendor shims (npm cmd-shim) forward `%*`, and cmd.exe parses
  // that expanded line again, consuming a second layer of carets.
  return escapeCmdCommand(escapeCmdCommand(quoted));
}

/**
 * Wrap Windows `.cmd`/`.bat` and `.ps1` shims in `cmd.exe` / `powershell.exe`
 * with `shell: false` so Node never rejects them with EINVAL and callers
 * never expose arguments to blanket shell word-splitting.
 */
export function resolveWindowsShimSpawn(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedSpawnSpec {
  if (platform !== 'win32') {
    return { executable, args: [...args] };
  }

  const ext = extname(executable).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const comSpec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const commandLine = [escapeCmdCommand(executable), ...args.map(escapeCmdArgument)].join(' ');
    return {
      executable: comSpec,
      // `cmd.exe /s /c` strips the outer pair of quotes, preserving inner quotes.
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      windowsVerbatimArguments: true,
    };
  }

  if (ext === '.ps1') {
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args],
    };
  }

  return { executable, args: [...args] };
}
