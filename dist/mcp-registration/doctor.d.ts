import type { McpClientId, McpPathContext, McpScope } from './types.js';
type FindingKind = 'project-config' | 'mcp-config' | 'backup';
type CleanupOutcome = 'CLEANED' | 'SKIPPED' | 'FAILED';
export interface McpDoctorFinding {
    path: string;
    kind: FindingKind;
    occurrences: number;
    clientIds: McpClientId[];
    scopes: McpScope[];
}
export interface McpDoctorCleanup {
    path: string;
    outcome: CleanupOutcome;
    detail: string;
}
export interface McpDoctorReport {
    confirmed: boolean;
    scannedFiles: number;
    findings: McpDoctorFinding[];
    cleanup: McpDoctorCleanup[];
    remainingFindings: McpDoctorFinding[];
}
export interface McpDoctorCommandOptions {
    /** Explicit confirmation. Without it doctor is a read-only audit. */
    yes?: boolean;
}
export interface McpDoctorDependencies {
    context?: Partial<McpPathContext>;
    hasValidPersonalCredential?: (apiUrl: string) => Promise<boolean>;
}
export interface McpDoctorCommandOutput {
    text: string;
    json: McpDoctorReport;
    exitCode: number;
}
export declare function runMcpDoctorCommand(options: McpDoctorCommandOptions, dependencies?: McpDoctorDependencies): Promise<McpDoctorCommandOutput>;
export {};
//# sourceMappingURL=doctor.d.ts.map