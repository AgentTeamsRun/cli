/**
 * Machine identity shared with the runner.
 *
 * The runner writes and reads the very same file (`daemon/src/utils/machine-id.ts`), which is what
 * lets the server tell "this agent was registered on machine X" apart from "this runner runs on
 * machine Y". The two implementations are intentionally duplicated because the runner ships with
 * zero runtime dependencies and cannot import CLI code; the file path and format are the contract.
 *
 * The value is an identifier, not a secret: it never authenticates or authorizes anything, and the
 * CLI must not read the runner's credential file (`~/.agentteams/daemon.json`) to learn it.
 */
export declare const getMachineIdPath: () => string;
export type MachineIdFileOptions = {
    path?: string;
    readFile?: (path: string) => string;
    writeFileExclusive?: (path: string, content: string) => void;
    writeFileOverwrite?: (path: string, content: string) => void;
    generateId?: () => string;
};
/**
 * Read the machine id, creating it when it does not exist yet.
 *
 * Creation uses an exclusive write so a runner and a CLI starting at the same time converge on one
 * value, and returns `null` when the file can be neither read nor written so registration keeps
 * working without machine matching.
 */
export declare function readOrCreateMachineId(options?: MachineIdFileOptions): string | null;
//# sourceMappingURL=machineId.d.ts.map