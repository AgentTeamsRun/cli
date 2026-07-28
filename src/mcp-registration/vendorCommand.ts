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

type SpawnSyncVendorCommand = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: BufferEncoding;
    shell: boolean;
    windowsHide: boolean;
    input: string;
    timeout: number;
  },
) => {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
  error?: Error;
};

/**
 * Vendor CLIs are invoked without a shell: the argument vector carries the
 * user's API key for user-scope installs, and a shell would expose it to
 * word-splitting and to shell history/tracing.
 */
export const createVendorRunner =
  (spawnSyncFn: SpawnSyncVendorCommand = spawnSync as SpawnSyncVendorCommand): VendorRunner =>
  (executable, args, options) => {
    // windows-hide-guard: child-process-alias spawnSyncFn
    const result = spawnSyncFn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf-8',
      shell: false,
      windowsHide: true,
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

export const runVendorCommand = createVendorRunner();
