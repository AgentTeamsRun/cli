import { extname } from 'node:path';

export interface ResolvedSpawnSpec {
  executable: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

function quoteCmdArgument(value: string): string {
  // Escape embedded double quotes and wrap in double quotes so cmd.exe treats
  // spaces and shell metacharacters (&, |, <, >, ^, (, )) literally.
  return `"${value.replace(/"/g, '\\"')}"`;
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
    const commandLine = [executable, ...args].map(quoteCmdArgument).join(' ');
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
