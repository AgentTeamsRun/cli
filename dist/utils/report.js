import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectGitMetrics } from './git.js';
import { toNonEmptyString, toNonNegativeInteger } from './parsers.js';
import { printFileInfo } from './spinner.js';
/**
 * --review-recommendation 값을 검증한다. REQUIRED/NOT_NEEDED만 허용하고,
 * 그 외 비어있지 않은 값은 경고 후 무시한다. report create/update가 공유한다.
 */
export function parseReviewRecommendation(value) {
    const raw = toNonEmptyString(value);
    if (raw === undefined)
        return undefined;
    if (raw === 'REQUIRED' || raw === 'NOT_NEEDED')
        return raw;
    console.warn(`Ignoring invalid --review-recommendation "${raw}" (expected REQUIRED or NOT_NEEDED)`);
    return undefined;
}
export function parseReportOptions(options, { planStartCommit, defaultStatus, } = {}) {
    const fileOption = options.reportFile ?? options.file;
    if (!fileOption) {
        return undefined;
    }
    const filePath = resolve(fileOption);
    if (!existsSync(filePath)) {
        throw new Error(`File not found: ${fileOption}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    printFileInfo(fileOption, content);
    if (!content || content.trim().length === 0) {
        throw new Error('Report file is empty.');
    }
    const title = (options.reportTitle ?? options.title ?? options.summary);
    if (!title || title.trim().length === 0) {
        const titleOptionName = options.reportTitle !== undefined ? '--report-title' : '--title';
        throw new Error(`${titleOptionName} is required when creating or attaching a completion report.`);
    }
    const status = toNonEmptyString(options.reportStatus) ?? toNonEmptyString(options.status) ?? defaultStatus;
    const autoGitMetrics = options.git === false ? {} : collectGitMetrics(undefined, { startCommit: planStartCommit });
    const commitHash = toNonEmptyString(options.commitHash) ?? autoGitMetrics.commitHash;
    const branchName = toNonEmptyString(options.branchName) ?? autoGitMetrics.branchName;
    const filesModified = toNonNegativeInteger(options.filesModified) ?? autoGitMetrics.filesModified;
    const linesAdded = toNonNegativeInteger(options.linesAdded) ?? autoGitMetrics.linesAdded;
    const linesDeleted = toNonNegativeInteger(options.linesDeleted) ?? autoGitMetrics.linesDeleted;
    const durationSeconds = toNonNegativeInteger(options.durationSeconds);
    const commitStart = toNonEmptyString(options.commitStart) ?? planStartCommit;
    const commitEnd = toNonEmptyString(options.commitEnd) ?? autoGitMetrics.commitHash;
    const pullRequestId = toNonEmptyString(options.pullRequestId);
    const qualityScore = toNonNegativeInteger(options.qualityScore);
    const reviewRecommendation = parseReviewRecommendation(options.reviewRecommendation);
    const reviewReason = toNonEmptyString(options.reviewReason);
    const payload = {
        title: title.trim(),
        content: content.trim(),
    };
    if (status !== undefined)
        payload.status = status;
    if (qualityScore !== undefined)
        payload.qualityScore = qualityScore;
    if (commitHash !== undefined)
        payload.commitHash = commitHash;
    if (branchName !== undefined)
        payload.branchName = branchName;
    if (filesModified !== undefined)
        payload.filesModified = filesModified;
    if (linesAdded !== undefined)
        payload.linesAdded = linesAdded;
    if (linesDeleted !== undefined)
        payload.linesDeleted = linesDeleted;
    if (durationSeconds !== undefined)
        payload.durationSeconds = durationSeconds;
    if (commitStart !== undefined)
        payload.commitStart = commitStart;
    if (commitEnd !== undefined)
        payload.commitEnd = commitEnd;
    if (pullRequestId !== undefined)
        payload.pullRequestId = pullRequestId;
    if (reviewRecommendation !== undefined)
        payload.reviewRecommendation = reviewRecommendation;
    if (reviewReason !== undefined)
        payload.reviewReason = reviewReason;
    return payload;
}
//# sourceMappingURL=report.js.map