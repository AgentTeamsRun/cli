import { type ConventionIssue, type ConventionLinkState } from '../utils/conventionLink.js';
export type DoctorStatus = 'READY' | 'DEGRADED' | 'NOT_APPLICABLE';
export interface DoctorIssue {
    code: string;
    path: string | null;
    message: string;
    severity: 'error' | 'info';
}
export interface DoctorEntryPointConflict {
    relativePath: string;
    state: 'tracked' | 'existing';
}
export interface DoctorRepositoryResult {
    path: string;
    status: 'READY' | 'DEGRADED';
    changedCount: number;
    exclude: 'ready' | 'blocked';
    link: ConventionLinkState;
    hook: 'ready' | 'blocked' | 'skipped';
    entryPointConflicts: DoctorEntryPointConflict[];
    issues: ConventionIssue[];
}
export interface DoctorResult {
    status: DoctorStatus;
    applicable: boolean;
    changedCount: number;
    rootDir: string | null;
    rootEntryPoints: string[];
    missingRecommendedEntryPoints: string[];
    repositories: DoctorRepositoryResult[];
    issues: DoctorIssue[];
}
type DoctorOptions = {
    cwd?: string;
};
export declare function executeDoctorCommand(options?: DoctorOptions): Promise<DoctorResult>;
export {};
//# sourceMappingURL=doctor.d.ts.map