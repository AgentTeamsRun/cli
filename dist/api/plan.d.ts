export declare function listPlans(apiUrl: string, projectId: string, headers: any, params?: Record<string, string | number>): Promise<any>;
export declare function getPlan(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function getPlanDependencies(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function createPlan(apiUrl: string, projectId: string, headers: any, body: {
    title: string;
    content: string;
    type?: string;
    complexity: string;
    priority: string;
    repositoryRemoteUrl?: string;
    status: 'BACKLOG';
    runnerType?: string;
    model?: string;
    fastMode?: boolean;
    kind?: string;
}): Promise<any>;
export declare function quickPlan(apiUrl: string, projectId: string, headers: any, body: {
    title: string;
    content: string;
    type?: string;
    complexity: string;
    priority: string;
    repositoryRemoteUrl?: string;
    startCommit?: string;
    startBranch?: string;
    runnerType: string;
    model: string;
    fastMode?: boolean;
    completionReport?: {
        repositoryRemoteUrl?: string;
        title: string;
        content: string;
        commitHash?: string;
        commitStart?: string;
        commitEnd?: string;
        branchName?: string;
        pullRequestId?: string;
        durationSeconds?: number;
        filesModified?: number;
        linesAdded?: number;
        linesDeleted?: number;
        status?: string;
        qualityScore?: number;
        reviewRecommendation?: string;
        reviewReason?: string;
    };
}): Promise<any>;
export declare function updatePlan(apiUrl: string, projectId: string, headers: any, id: string, body: Record<string, unknown>): Promise<any>;
export declare function startPlanLifecycle(apiUrl: string, projectId: string, headers: any, id: string, body: {
    task?: string;
    startCommit?: string;
    startBranch?: string;
    runnerType?: string;
    model?: string;
    fastMode?: boolean;
}): Promise<any>;
export declare function finishPlanLifecycle(apiUrl: string, projectId: string, headers: any, id: string, body: {
    task?: string;
    runnerType?: string;
    model?: string;
    fastMode?: boolean;
    completionReport?: {
        repositoryRemoteUrl?: string;
        title: string;
        content: string;
        commitHash?: string;
        commitStart?: string;
        commitEnd?: string;
        branchName?: string;
        pullRequestId?: string;
        durationSeconds?: number;
        filesModified?: number;
        linesAdded?: number;
        linesDeleted?: number;
        status?: string;
        qualityScore?: number;
        reviewRecommendation?: string;
        reviewReason?: string;
    };
}): Promise<any>;
export declare function deletePlan(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function getPlanStatus(apiUrl: string, projectId: string, headers: any, id: string): Promise<any>;
export declare function patchPlanStatus(apiUrl: string, projectId: string, headers: any, id: string, status: string): Promise<any>;
export declare function listOriginIssues(apiUrl: string, projectId: string, headers: any, planId: string): Promise<any>;
export declare function linkOriginIssue(apiUrl: string, projectId: string, headers: any, planId: string, body: {
    provider: string;
    externalId: string;
    externalUrl: string;
    externalTitle?: string;
    metadata?: Record<string, unknown>;
}): Promise<any>;
export declare function unlinkOriginIssue(apiUrl: string, projectId: string, headers: any, planId: string, issueId: string): Promise<any>;
export declare function uploadPlanHtml(apiUrl: string, projectId: string, headers: any, id: string, body: {
    html: string;
    curationType: 'AI_CURATED';
    sourceLabel?: string;
}): Promise<any>;
//# sourceMappingURL=plan.d.ts.map