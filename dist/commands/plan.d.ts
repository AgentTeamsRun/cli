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
//# sourceMappingURL=plan.d.ts.map