import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { MCP_CLIENTS } from './clients.js';
import type { DetectionSignal, McpClientDefinition, McpPathContext } from './types.js';

/**
 * CLI-local client detection.
 *
 * The daemon has its own executable resolver, but the public CLI is published
 * from a `cli/`-only subtree split and cannot import `daemon/src/executable.ts`.
 * The lookup is kept injectable so tests drive it with a fake PATH and a
 * temporary HOME rather than the developer's real machine.
 */

export interface DetectionDependencies {
  context: McpPathContext;
  fileExists?: (path: string) => boolean;
  /** Windows resolves executables through PATHEXT; the default mirrors that. */
  executableSuffixes?: string[];
}

function defaultSuffixes(platform: string): string[] {
  return platform === 'win32' ? ['', '.cmd', '.exe', '.bat', '.ps1'] : [''];
}

function resolveExecutable(
  client: McpClientDefinition,
  dependencies: Required<Pick<DetectionDependencies, 'fileExists'>> & DetectionDependencies,
): string | null {
  const { context, fileExists } = dependencies;
  const suffixes = dependencies.executableSuffixes ?? defaultSuffixes(process.platform);
  const pathDirs = (context.env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0);
  const extraDirs = client.extraBinDirs ? client.extraBinDirs(context) : [];

  for (const directory of [...pathDirs, ...extraDirs]) {
    for (const executable of client.executables) {
      for (const suffix of suffixes) {
        const candidate = join(directory, `${executable}${suffix}`);
        if (fileExists(candidate)) return candidate;
      }
    }
  }

  return null;
}

/**
 * Config traces and an executable are independent signals: a client counts as a
 * candidate when either one is present. Reporting *which* signal fired is what
 * lets a user tell "installed but never configured" apart from "config left
 * behind by an uninstall".
 */
export function detectClients(dependencies: DetectionDependencies): DetectionSignal[] {
  const fileExists = dependencies.fileExists ?? existsSync;
  const resolved = { ...dependencies, fileExists };

  return MCP_CLIENTS.map((client) => {
    const configPaths = client.configSignals(dependencies.context).filter((path) => fileExists(path));
    const executablePath = resolveExecutable(client, resolved);

    const hasConfig = configPaths.length > 0;
    const hasExecutable = executablePath !== null;
    const evidence: DetectionSignal['evidence'] =
      hasConfig && hasExecutable ? 'both' : hasConfig ? 'configured' : hasExecutable ? 'executable' : 'none';

    return {
      clientId: client.id,
      label: client.label,
      evidence,
      executablePath,
      configPaths,
      detected: hasConfig || hasExecutable,
    };
  });
}
