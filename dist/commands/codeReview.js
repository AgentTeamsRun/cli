import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cancelCodeReview, createCodeReview, createPlanFromCodeReview, deleteCodeReview, dismissCodeReviewFinding, getCodeReview, getCodeReviewFinding, listCodeReviews, resolveCodeReviewFinding, submitCodeReviewResult, undismissCodeReviewFinding, updateCodeReview, } from '../api/codeReview.js';
import { getGitRemoteOriginUrl } from '../utils/git.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
import { withSpinner } from '../utils/spinner.js';
const parseCsv = (value) => {
    if (typeof value !== 'string')
        return [];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};
const readOptionalFile = (file) => {
    if (typeof file !== 'string' || file.trim().length === 0)
        return undefined;
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
        throw new Error(`File not found: ${file}`);
    }
    return readFileSync(filePath, 'utf-8');
};
const FINDING_REQUIRED_FIELDS = ['severity', 'title', 'filePath', 'problem', 'impact', 'suggestion'];
const parseFindingsFile = (file) => {
    const raw = readOptionalFile(file);
    if (raw === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid findings JSON: ${message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error('findings file must contain a JSON array');
    }
    parsed.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`findings[${index}] must be an object`);
        }
        for (const field of FINDING_REQUIRED_FIELDS) {
            const value = item[field];
            if (value === undefined || value === null || value === '') {
                throw new Error(`findings[${index}] missing required field: ${field}`);
            }
        }
    });
    return parsed;
};
const addOptionalStringField = (body, field, value) => {
    const parsed = toNonEmptyString(value);
    if (parsed) {
        body[field] = parsed;
    }
};
const parseFindingIdOptions = (options, action) => {
    const findingIds = [
        ...parseCsv(options.findingIds),
        ...(toNonEmptyString(options.findingId) ? [toNonEmptyString(options.findingId)] : []),
    ];
    const uniqueFindingIds = [...new Set(findingIds)];
    if (uniqueFindingIds.length === 0) {
        throw new Error(`--finding-id or --finding-ids is required for code-review ${action}`);
    }
    return uniqueFindingIds;
};
export async function executeCodeReviewCommand(apiUrl, projectId, headers, action, options) {
    switch (action) {
        case 'list': {
            const params = {};
            if (options.search)
                params.search = options.search;
            if (options.status)
                params.status = options.status;
            if (options.targetType)
                params.targetType = options.targetType;
            if (options.sourcePlanId)
                params.sourcePlanId = options.sourcePlanId;
            if (options.sourceCompletionReportId)
                params.sourceCompletionReportId = options.sourceCompletionReportId;
            const page = toPositiveInteger(options.page);
            const pageSize = toPositiveInteger(options.pageSize);
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return listCodeReviews(apiUrl, projectId, headers, params);
        }
        case 'get':
        case 'show': {
            // --finding-id가 있으면 리뷰 전체 대신 단일 finding(+부모 리뷰 헤더)만 포커스 조회한다.
            // (agentteams_rvf_<id> / codeReview:R:F 서브 엔티티 핸드오프 경로.) --id는 이 분기에서 선택.
            const findingId = toNonEmptyString(options.findingId);
            if (findingId) {
                return getCodeReviewFinding(apiUrl, projectId, headers, findingId, toNonEmptyString(options.id));
            }
            if (!options.id)
                throw new Error('--id or --finding-id is required for code-review get');
            return getCodeReview(apiUrl, projectId, headers, options.id);
        }
        case 'create': {
            const title = toNonEmptyString(options.title);
            if (!title)
                throw new Error('--title is required for code-review create');
            const runnerType = toNonEmptyString(options.runnerType);
            const model = toNonEmptyString(options.model);
            if (!runnerType || !model) {
                throw new Error('--runner-type and --model are required for code-review create');
            }
            const targetType = toNonEmptyString(options.targetType) ?? 'LOCAL_DIFF';
            const diffSummary = toNonEmptyString(options.diffSummary) ?? readOptionalFile(options.diffFile);
            const testSummary = toNonEmptyString(options.testSummary) ?? readOptionalFile(options.testFile);
            const findings = parseFindingsFile(options.findingsFile);
            const explicitRepositoryRemoteUrl = toNonEmptyString(options.repositoryRemoteUrl);
            const repositoryRemoteUrl = explicitRepositoryRemoteUrl ?? (options.git === false ? undefined : getGitRemoteOriginUrl());
            if (!explicitRepositoryRemoteUrl && options.git !== false && !repositoryRemoteUrl) {
                process.stderr.write('[warn] Unable to auto-detect the repository remote URL. Run from a member repository or pass --repository-remote-url.\n');
            }
            const body = {
                title,
                targetType,
                ...(repositoryRemoteUrl ? { repositoryRemoteUrl } : {}),
            };
            if (options.targetRef)
                body.targetRef = options.targetRef;
            if (options.sourcePlanId)
                body.sourcePlanId = options.sourcePlanId;
            if (options.sourceCompletionReportId)
                body.sourceCompletionReportId = options.sourceCompletionReportId;
            if (options.sourceCommitStart)
                body.sourceCommitStart = options.sourceCommitStart;
            if (options.sourceCommitEnd)
                body.sourceCommitEnd = options.sourceCommitEnd;
            if (options.sourceBranchName)
                body.sourceBranchName = options.sourceBranchName;
            if (options.baseBranchName)
                body.baseBranchName = options.baseBranchName;
            if (diffSummary)
                body.diffSummary = diffSummary;
            if (testSummary)
                body.testSummary = testSummary;
            if (options.reviewerContext)
                body.reviewerContext = options.reviewerContext;
            body.runnerType = runnerType;
            body.model = model;
            if (options.recommendationReason)
                body.recommendationReason = options.recommendationReason;
            if (findings !== undefined)
                body.findings = findings;
            return withSpinner('Creating code review...', () => createCodeReview(apiUrl, projectId, headers, body), 'Code review created');
        }
        case 'update': {
            if (!options.id)
                throw new Error('--id is required for code-review update');
            const body = {};
            addOptionalStringField(body, 'title', options.title);
            addOptionalStringField(body, 'targetType', options.targetType);
            addOptionalStringField(body, 'targetRef', options.targetRef);
            addOptionalStringField(body, 'sourceCommitStart', options.sourceCommitStart);
            addOptionalStringField(body, 'sourceCommitEnd', options.sourceCommitEnd);
            addOptionalStringField(body, 'sourceBranchName', options.sourceBranchName);
            addOptionalStringField(body, 'baseBranchName', options.baseBranchName);
            const diffSummary = toNonEmptyString(options.diffSummary) ?? readOptionalFile(options.diffFile);
            const testSummary = toNonEmptyString(options.testSummary) ?? readOptionalFile(options.testFile);
            if (diffSummary !== undefined)
                body.diffSummary = diffSummary;
            if (testSummary !== undefined)
                body.testSummary = testSummary;
            addOptionalStringField(body, 'reviewerContext', options.reviewerContext);
            addOptionalStringField(body, 'recommendationReason', options.recommendationReason);
            addOptionalStringField(body, 'runnerType', options.runnerType);
            addOptionalStringField(body, 'model', options.model);
            if (Object.keys(body).length === 0) {
                throw new Error('At least one metadata field is required for code-review update');
            }
            return withSpinner('Updating code review...', () => updateCodeReview(apiUrl, projectId, headers, options.id, body), 'Code review updated');
        }
        case 'create-plan': {
            if (!options.id)
                throw new Error('--id is required for code-review create-plan');
            const title = toNonEmptyString(options.title);
            if (!title)
                throw new Error('--title is required for code-review create-plan');
            const findingIds = parseCsv(options.findingIds);
            if (findingIds.length === 0) {
                throw new Error('--finding-ids is required for code-review create-plan');
            }
            return withSpinner('Creating plan from selected findings...', () => createPlanFromCodeReview(apiUrl, projectId, headers, options.id, {
                title,
                findingIds,
                priority: options.priority,
                type: options.type,
                runnerType: options.runnerType,
                model: options.model,
            }), 'Plan created');
        }
        case 'cancel': {
            if (!options.id)
                throw new Error('--id is required for code-review cancel');
            return withSpinner('Cancelling code review...', () => cancelCodeReview(apiUrl, projectId, headers, options.id), 'Code review cancelled');
        }
        case 'submit-result': {
            if (!options.id)
                throw new Error('--id is required for code-review submit-result');
            const status = toNonEmptyString(options.status);
            if (status && status !== 'COMPLETED' && status !== 'FAILED') {
                throw new Error('--status must be COMPLETED or FAILED for code-review submit-result');
            }
            const findings = parseFindingsFile(options.findingsFile);
            const resultSummary = toNonEmptyString(options.resultSummary);
            const errorMessage = toNonEmptyString(options.errorMessage);
            const body = {};
            if (status)
                body.status = status;
            if (findings !== undefined)
                body.findings = findings;
            if (resultSummary)
                body.resultSummary = resultSummary;
            if (errorMessage)
                body.errorMessage = errorMessage;
            return withSpinner('Submitting code review result...', () => submitCodeReviewResult(apiUrl, projectId, headers, options.id, body), 'Code review result submitted');
        }
        case 'delete': {
            if (!options.id)
                throw new Error('--id is required for code-review delete');
            return withSpinner('Deleting code review...', () => deleteCodeReview(apiUrl, projectId, headers, options.id), 'Code review deleted');
        }
        case 'dismiss': {
            if (!options.id)
                throw new Error('--id is required for code-review dismiss');
            if (!options.findingId)
                throw new Error('--finding-id is required for code-review dismiss');
            return withSpinner('Dismissing finding...', () => dismissCodeReviewFinding(apiUrl, projectId, headers, options.id, options.findingId), 'Finding dismissed');
        }
        case 'resolve': {
            if (!options.id)
                throw new Error('--id is required for code-review resolve');
            const findingIds = parseFindingIdOptions(options, 'resolve');
            return withSpinner(findingIds.length === 1 ? 'Resolving finding...' : 'Resolving findings...', async () => {
                const results = [];
                for (const findingId of findingIds) {
                    results.push(await resolveCodeReviewFinding(apiUrl, projectId, headers, options.id, findingId));
                }
                return findingIds.length === 1
                    ? results[0]
                    : {
                        data: {
                            codeReviewId: options.id,
                            findingIds,
                            results,
                        },
                    };
            }, findingIds.length === 1 ? 'Finding resolved' : 'Findings resolved');
        }
        case 'undismiss': {
            if (!options.id)
                throw new Error('--id is required for code-review undismiss');
            if (!options.findingId)
                throw new Error('--finding-id is required for code-review undismiss');
            return withSpinner('Restoring finding...', () => undismissCodeReviewFinding(apiUrl, projectId, headers, options.id, options.findingId), 'Finding restored');
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=codeReview.js.map