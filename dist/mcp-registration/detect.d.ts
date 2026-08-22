import type { DetectionSignal, McpPathContext } from './types.js';
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
    probeExecutable?: (executablePath: string, args: string[]) => string | null;
}
/**
 * Config traces and an executable are independent signals: a client counts as a
 * candidate when either one is present. Reporting *which* signal fired is what
 * lets a user tell "installed but never configured" apart from "config left
 * behind by an uninstall".
 */
export declare function detectClients(dependencies: DetectionDependencies): DetectionSignal[];
//# sourceMappingURL=detect.d.ts.map