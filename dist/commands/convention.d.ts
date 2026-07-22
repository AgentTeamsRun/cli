import type { Config } from '../types/index.js';
type ConventionCommandOptions = {
    cwd?: string;
    config?: Config;
    currentCliVersion?: string;
    latestCliVersion?: string | null;
};
type ConventionUploadOptions = ConventionCommandOptions & {
    file: string | string[];
    apply?: boolean;
};
type ConventionDeleteOptions = ConventionCommandOptions & {
    file: string | string[];
    apply?: boolean;
};
type ConventionCreateOptions = ConventionCommandOptions & {
    file: string | string[];
    scope?: string;
};
export type ConventionFreshnessChange = {
    id: string;
    type: 'new' | 'updated' | 'deleted';
    title?: string;
    fileName?: string;
};
export type ConventionFreshnessResult = {
    platformGuidesChanged: boolean;
    conventionChanges: ConventionFreshnessChange[];
};
export declare function conventionShow(): Promise<any>;
export declare function checkConventionFreshness(apiUrl: string, projectId: string, headers: Record<string, string>, projectRoot: string): Promise<ConventionFreshnessResult>;
export type ConventionStatusResult = {
    /** True when the local conventions are behind the server (any change or platform-guide drift). */
    updateAvailable: boolean;
    /** Explicit alias for updateAvailable; CLI updates are reported separately. */
    conventionUpdateAvailable: boolean;
    platformGuidesChanged: boolean;
    conventionChanges: ConventionFreshnessChange[];
    cliUpdateAvailable: boolean;
    currentCliVersion: string;
    latestCliVersion: string | null;
    /** True when either conventions or the CLI need action. */
    actionRequired: boolean;
    actions: {
        updateCli: string | null;
        syncConventions: string | null;
    };
    /** Strong, machine-readable next-step hints for agents and humans. */
    hints: string[];
    /** One-line human-readable summary. */
    summary: string;
};
export declare function buildStatusSummary(result: ConventionFreshnessResult): string;
/**
 * Read-only freshness check exposed as `agentteams convention status`.
 *
 * Compares the local download manifest against the server and reports whether an
 * update is available — it never downloads or mutates anything. Degrades gracefully
 * (exit 0, updateAvailable=false) when the project is not configured or has no local
 * conventions yet, so callers can safely "check then skip when unavailable".
 */
export declare function conventionStatus(options?: ConventionCommandOptions): Promise<ConventionStatusResult>;
export declare function conventionList(): Promise<any>;
export declare function conventionDownload(options?: ConventionCommandOptions): Promise<string>;
export declare function conventionCreate(options: ConventionCreateOptions): Promise<string>;
export declare function conventionUpdate(options: ConventionUploadOptions): Promise<string>;
export declare function conventionDelete(options: ConventionDeleteOptions): Promise<string>;
export {};
//# sourceMappingURL=convention.d.ts.map