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
export declare function parseReportOptions(options: any, { planStartCommit, defaultStatus, }?: {
    planStartCommit?: string;
    defaultStatus?: string;
}): ReportPayload | undefined;
//# sourceMappingURL=report.d.ts.map