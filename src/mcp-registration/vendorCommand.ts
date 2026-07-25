import { spawnSync } from 'node:child_process';

export interface VendorCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError?: string;
}

export type VendorRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => VendorCommandResult;

/**
 * Vendor CLIs are invoked without a shell: the argument vector carries the
 * user's API key for user-scope installs, and a shell would expose it to
 * word-splitting and to shell history/tracing.
 */
export const runVendorCommand: VendorRunner = (executable, args, options) => {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf-8',
    shell: false,
    // Some registration commands prompt when they detect a TTY; an explicit
    // empty stdin keeps them non-interactive.
    input: '',
    timeout: 120_000,
  });

  if (result.error) {
    return { status: null, stdout: '', stderr: '', spawnError: result.error.message };
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};
