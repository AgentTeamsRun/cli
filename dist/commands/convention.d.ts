import type { Config } from '../types/index.js';
export declare const CONVENTION_DIR = ".agentteams";
export declare const CONVENTION_INDEX_FILE = "convention.md";
/** Exported so `init` can tell "never downloaded" from "up to date" without a second copy of the name. */
export declare const CONVENTION_MANIFEST_FILE = "conventions.manifest.json";
type ConventionCommandOptions = {
    cwd?: string;
    config?: Config;
    currentCliVersion?: string;
    latestCliVersion?: string | null;
    agentConfigId?: string;
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
export type ConventionDownloadResult = {
    message: string;
    unmanagedFiles?: string[];
    warning?: string;
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
export declare function findProjectRoot(cwd?: string): string | null;
export declare function getApiConfigOrThrow(options?: ConventionCommandOptions): Promise<{
    config: Config;
    apiUrl: string;
    headers: {
        'Content-Type': string;
    };
}>;
/**
 * 매니페스트에 기록된 배포 경로 목록. `session sync`가 다운로드 전후로 같은 목록을 떠서
 * 내용이 바뀐 파일을 가려내는 데 쓴다.
 *
 * ⚠️ `convention.md`는 이 목록에 **없다** — 매니페스트 엔트리가 아니라 별도 경로
 * (`downloadReportingTemplate`)로 받아오기 때문이다. 재독 대상을 매니페스트만 보고
 * 만들면 always_on인 그 파일이 조용히 빠진다. 호출부가 따로 더해야 한다.
 */
export declare function readDeployedConventionPaths(projectRoot: string): string[];
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
    /**
     * Set when the project *is* configured but its credential could not be
     * resolved. Distinguishes "nothing to check" from "could not check" — the
     * latter must never read as "up to date".
     */
    credentialProblem?: string;
};
export declare function buildStatusSummary(result: ConventionFreshnessResult): string;
/**
 * Read-only freshness check exposed as `agentteams convention status`.
 *
 * Compares the local download manifest against the server and reports whether an
 * update is available — it never downloads or mutates anything. Degrades gracefully
 * (exit 0, updateAvailable=false) when the project is not configured or has no local
 * conventions yet, so callers can safely "check then skip when unavailable".
 *
 * "Not configured" and "configured but the credential failed" are reported
 * differently on purpose. The platform convention makes this the session-start
 * freshness gate, so a project whose login is broken must say so instead of
 * quietly claiming its rules are current.
 */
export declare function conventionStatus(options?: ConventionCommandOptions): Promise<ConventionStatusResult>;
export declare function conventionList(): Promise<any>;
export declare function conventionDownload(options?: ConventionCommandOptions): Promise<ConventionDownloadResult>;
export declare function conventionCreate(options: ConventionCreateOptions): Promise<string>;
export declare function conventionUpdate(options: ConventionUploadOptions): Promise<string>;
export declare function conventionDelete(options: ConventionDeleteOptions): Promise<string>;
export {};
//# sourceMappingURL=convention.d.ts.map