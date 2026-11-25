import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
export const getMachineIdPath = () => join(homedir(), '.agentteams', 'machine-id');
const normalizeMachineId = (rawValue) => {
    const normalized = rawValue.trim();
    return normalized.length > 0 ? normalized : null;
};
/**
 * Read the machine id, creating it when it does not exist yet.
 *
 * Creation uses an exclusive write so a runner and a CLI starting at the same time converge on one
 * value, and returns `null` when the file can be neither read nor written so registration keeps
 * working without machine matching.
 */
export function readOrCreateMachineId(options = {}) {
    const path = options.path ?? getMachineIdPath();
    const readFile = options.readFile ?? ((target) => readFileSync(target, 'utf8'));
    const generateId = options.generateId ?? randomUUID;
    const write = (target, content, exclusive) => {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w', mode: 0o600 });
        chmodSync(target, 0o600);
    };
    const writeFileExclusive = options.writeFileExclusive ?? ((target, content) => write(target, content, true));
    const writeFileOverwrite = options.writeFileOverwrite ?? ((target, content) => write(target, content, false));
    try {
        const existing = normalizeMachineId(readFile(path));
        if (existing) {
            return existing;
        }
    }
    catch {
        // Missing or unreadable file: fall through to creation.
    }
    const generated = generateId();
    try {
        writeFileExclusive(path, `${generated}\n`);
        return generated;
    }
    catch {
        try {
            const raced = normalizeMachineId(readFile(path));
            if (raced) {
                return raced;
            }
        }
        catch {
            return null;
        }
        try {
            writeFileOverwrite(path, `${generated}\n`);
            return generated;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=machineId.js.map