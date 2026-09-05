import { spawnSync } from 'node:child_process';
/**
 * Vendor CLIs are invoked without a shell: the argument vector carries the
 * user's API key for user-scope installs, and a shell would expose it to
 * word-splitting and to shell history/tracing.
 */
export const createVendorRunner = (spawnSyncFn = spawnSync) => (executable, args, options) => {
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
//# sourceMappingURL=vendorCommand.js.map