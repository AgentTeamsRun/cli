export declare function getPlanTask(apiUrl: string, projectId: string, headers: Record<string, string>, taskId: string, planId?: string): Promise<unknown>;
export declare function startPlanTask(apiUrl: string, projectId: string, headers: Record<string, string>, planId: string, taskId: string): Promise<unknown>;
export type PlanTaskFinishGit = {
    commit: string;
    branch: string | null;
    commitOnRemote: boolean | null;
};
export type PlanTaskFinishReport = {
    title?: string;
    content: string;
    status: string;
    repositoryRemoteUrl?: string;
    commitHash?: string;
    commitStart?: string;
    commitEnd?: string;
    branchName?: string;
    filesModified?: number;
    linesAdded?: number;
    linesDeleted?: number;
    qualityScore?: number;
    reviewRecommendation?: string;
    reviewReason?: string;
};
export type PlanTaskFinishReportAttachment = {
    completionReport: PlanTaskFinishReport;
    runnerType: string;
    model: string;
    fastMode?: boolean;
};
export declare function finishPlanTask(apiUrl: string, projectId: string, headers: Record<string, string>, planId: string, taskId: string, status: string, git?: PlanTaskFinishGit, report?: PlanTaskFinishReportAttachment): Promise<unknown>;
//# sourceMappingURL=task.d.ts.map