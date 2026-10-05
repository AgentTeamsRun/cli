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
 * 그 외 비어있지 않은 값은 경고 후 무시한다. report create와 plan finish의 보고서 생성 경로가 공유한다.
 */
export declare function parseReviewRecommendation(value: unknown): string | undefined;
/**
 * 완료보고서 파일을 읽어 trim한 본문을 돌려준다. 파일이 없거나 비어 있으면 요청 전에 멈춘다.
 * parseReportOptions와 task finish의 태스크 보고서 경로가 공유한다.
 */
export declare function readReportFile(fileOption: string): string;
export declare function parseReportOptions(options: any, { planStartCommit, defaultStatus, }?: {
    planStartCommit?: string;
    defaultStatus?: string;
}): ReportPayload | undefined;
//# sourceMappingURL=report.d.ts.map