export interface ReportPayload {
    title: string;
    content: string;
    status?: string;
    qualityScore?: number;
    commitHash?: string;
    branchName?: string;
    filesModified?: number;
    linesAdded?: number;
    linesDeleted?: number;
    durationSeconds?: number;
    commitStart?: string;
    commitEnd?: string;
    pullRequestId?: string;
    reviewRecommendation?: string;
    reviewReason?: string;
}
/**
 * --review-recommendation 값을 검증한다. REQUIRED/NOT_NEEDED만 허용하고,
 * 그 외 비어있지 않은 값은 경고 후 무시한다. report create/update가 공유한다.
 */
export declare function parseReviewRecommendation(value: unknown): string | undefined;
export declare function parseReportOptions(options: any, { planStartCommit, defaultStatus, }?: {
    planStartCommit?: string;
    defaultStatus?: string;
}): ReportPayload | undefined;
//# sourceMappingURL=report.d.ts.map