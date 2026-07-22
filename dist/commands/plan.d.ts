type PlanRunbookTask = {
    id: string;
    title: string;
    status: string;
    orderIndex: number;
    dependsOnTaskIds?: string[];
};
type PlanRunbookProgress = {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    skipped: number;
    blocked: number;
    completed: number;
    percent: number;
};
export declare function assertComplexityReasonCanBeRecorded(complexityReason: unknown, nextComplexity: string | undefined, currentComplexity?: string | null): void;
export declare const getPlanComplexityValues: () => readonly string[];
export declare function buildFreshnessNoticeLines(freshness: {
    platformGuidesChanged: boolean;
    conventionChanges: Array<{
        type: 'new' | 'updated' | 'deleted';
        title?: string;
        fileName?: string;
        id: string;
    }>;
}): string[];
export declare function buildUniquePlanRunbookFileName(title: string, planId: string, existingFileNames: string[]): string;
export declare function buildPlanRunbookFrontmatter(plan: {
    id: string;
    title: string;
    status: string;
    priority: string;
    webUrl?: string | null;
    contentVersion?: string | null;
    downloadedAt: string;
}): string;
export declare function buildPlanRunbookMarkdown(plan: {
    contentVersion?: string | null;
    contentMarkdown?: string | null;
    progress?: PlanRunbookProgress | null;
}): string;
export declare function addTaskIdCommentsToPlanRunbook(markdown: string, tasks: PlanRunbookTask[], contentVersion?: string | null): string;
export declare function buildPlanTaskSidecar(planId: string, tasks: PlanRunbookTask[]): {
    planId: string;
    tasks: {
        id: string;
        number: number;
        title: string;
        status: string;
        dependsOnTaskIds: string[];
        dependsOnTaskNumbers: number[];
    }[];
};
export declare function readPlanHtmlUploadInput(options: {
    file?: string;
    stdin?: boolean;
}): string;
export declare function hasPlanHtmlPreviewInput(options: {
    htmlFile?: string;
    htmlStdin?: boolean;
}): boolean;
export declare function readPlanHtmlPreviewInput(options: {
    htmlFile?: string;
    htmlStdin?: boolean;
}): string;
export declare function buildQuickPlanResult(planId: string, createResult: unknown, finishResult: unknown): Record<string, unknown>;
export declare function executePlanCommand(apiUrl: string, projectId: string, headers: any, action: string, options: any): Promise<any>;
export {};
//# sourceMappingURL=plan.d.ts.map