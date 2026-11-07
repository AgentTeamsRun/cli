import { type DetectionDependencies } from '../mcp-registration/detect.js';
import type { McpPathContext } from '../mcp-registration/types.js';
import { type SessionHookScope } from '../session-hooks/clients.js';
import { type SessionHookInstallState } from '../session-hooks/install.js';
import { type ConventionIssue, type ConventionLinkState } from '../utils/conventionLink.js';
export type DoctorStatus = 'READY' | 'DEGRADED' | 'NOT_APPLICABLE';
/**
 * Which project layout the diagnosis ran against. Output and readiness rules
 * differ per layout, so this — not a derived field such as `rootHook` — is what
 * consumers branch on.
 */
export type DoctorLayout = 'git-root' | 'non-git-root' | 'unknown';
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
    layout: DoctorLayout;
    applicable: boolean;
    changedCount: number;
    rootDir: string | null;
    rootEntryPoints: string[];
    missingRecommendedEntryPoints: string[];
    repositories: DoctorRepositoryResult[];
    /**
     * State of the worktree bootstrap hook on the convention root itself. Only a
     * git root project has one — a non-git root has no git-common dir and its
     * hooks live per member repo (`DoctorRepositoryResult.hook`), so it reports
     * `skipped`.
     */
    rootHook: 'ready' | 'blocked' | 'skipped';
    /**
     * The Claude Code SessionStart hook per settings scope. Present only when
     * Claude Code is detected on this machine. Purely informational: it never
     * changes `status`, and the doctor never installs it.
     */
    sessionHook?: DoctorSessionHookResult;
    issues: DoctorIssue[];
}
/** `unreadable`: the settings file exists but could not be read or parsed. */
export type DoctorSessionHookState = SessionHookInstallState | 'unreadable';
export interface DoctorSessionHookScopeResult {
    scope: SessionHookScope;
    state: DoctorSessionHookState;
    configPath: string;
}
export interface DoctorSessionHookResult {
    clientId: 'claude-code';
    scopes: DoctorSessionHookScopeResult[];
}
export type DoctorSessionHookDependencies = {
    context?: Partial<McpPathContext>;
    detectionDependencies?: Omit<DetectionDependencies, 'context'>;
};
type DoctorOptions = {
    cwd?: string;
    /**
     * Install the managed post-checkout hook even when this repository has no
     * linked worktree yet. Without it the doctor honors the same gate `init` does.
     */
    installWorktreeHook?: boolean;
    /** Injection seam so tests drive Claude Code detection with a temporary HOME/PATH. */
    sessionHookDependencies?: DoctorSessionHookDependencies;
};
export declare function executeDoctorCommand(options?: DoctorOptions): Promise<DoctorResult>;
export {};
//# sourceMappingURL=doctor.d.ts.map