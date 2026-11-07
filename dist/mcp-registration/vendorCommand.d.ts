export interface VendorCommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
    /** Set when the process could not be started at all (e.g. ENOENT). */
    spawnError?: string;
}
export type VendorRunner = (executable: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
}) => VendorCommandResult;
type SpawnSyncVendorCommand = (executable: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: BufferEncoding;
    shell: boolean;
    windowsHide: boolean;
    input: string;
    timeout: number;
}) => {
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
export declare const createVendorRunner: (spawnSyncFn?: SpawnSyncVendorCommand) => VendorRunner;
export declare const runVendorCommand: VendorRunner;
export {};
//# sourceMappingURL=vendorCommand.d.ts.map