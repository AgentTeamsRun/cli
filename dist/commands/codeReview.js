import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cancelCodeReview, createCodeReview, createPlanFromCodeReview, deleteCodeReview, dismissCodeReviewFinding, getCodeReview, getCodeReviewFinding, listCodeReviewFindings, listCodeReviews, resolveCodeReviewFinding, submitCodeReviewResult, undismissCodeReviewFinding, updateCodeReview, } from '../api/codeReview.js';
import { getGitRemoteOriginUrl } from '../utils/git.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
import { EXECUTION_SNAPSHOT_HINT, resolveExecutionSnapshot } from '../utils/agentIdentity.js';
import { withSpinner } from '../utils/spinner.js';
import { mutationContractFields, writeContractFields } from '../utils/writeContract.js';
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
const CODE_REVIEW_FINDING_IMPACT_AREA_VALUES = [
    'UI',
    'BUSINESS_RULE',
    'CONTRACT',
    'DATA',
    'SECURITY',
    'OPS',
    'DOCS',
    'TEST',
    'OTHER',
];
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
        const impactArea = item.impactArea;
        if (typeof impactArea !== 'string' ||
            !CODE_REVIEW_FINDING_IMPACT_AREA_VALUES.includes(impactArea)) {
            throw new Error(`findings[${index}].impactArea is required and must be one of: ${CODE_REVIEW_FINDING_IMPACT_AREA_VALUES.join(', ')} (see the code review guide's "Choosing impactArea")`);
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
        case 'finding-list': {
            const id = toNonEmptyString(options.id);
            if (!id)
                throw new Error('--id is required for code-review finding-list');
            const params = {};
            const page = toPositiveInteger(options.page);
            const pageSize = toPositiveInteger(options.pageSize);
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return listCodeReviewFindings(apiUrl, projectId, headers, id, params);
        }
        case 'get': {
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
            const { runnerType, model } = resolveExecutionSnapshot(options);
            if (!runnerType || !model) {
                throw new Error('--runner-type and --model are required for code-review create' + EXECUTION_SNAPSHOT_HINT);
            }
            const targetType = toNonEmptyString(options.targetType) ?? 'LOCAL_DIFF';
            const diffSummary = toNonEmptyString(options.diffSummary) ?? readOptionalFile(options.diffFile);
            const testSummary = toNonEmptyString(options.testSummary) ?? readOptionalFile(options.testFile);
            const resultSummary = toNonEmptyString(options.resultSummary) ?? toNonEmptyString(readOptionalFile(options.resultSummaryFile));
            const findings = parseFindingsFile(options.findingsFile);
            // 총평은 결과가 있는 리뷰에만 붙는다. 서버도 400으로 막지만 어떤 필드가 문제인지 알려주지 않으므로,
            // MCP 표면(validateInitialCodeReviewResultSummary)과 같은 문구로 API 호출 전에 거절한다.
            if (resultSummary !== undefined && findings === undefined) {
                throw new Error('--result-summary/--result-summary-file requires --findings-file for code-review create');
            }
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
            if (resultSummary)
                body.resultSummary = resultSummary;
            if (options.reviewerContext)
                body.reviewerContext = options.reviewerContext;
            body.runnerType = runnerType;
            body.model = model;
            if (options.recommendationReason)
                body.recommendationReason = options.recommendationReason;
            if (findings !== undefined)
                body.findings = findings;
            Object.assign(body, writeContractFields(options));
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
            // 계약 필드는 "변경할 내용"이 아니므로 위 검사 뒤에 붙인다. --guide-hash만 준 호출은 여전히 오류다.
            Object.assign(body, mutationContractFields(options));
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
            return withSpinner('Cancelling code review...', () => cancelCodeReview(apiUrl, projectId, headers, options.id, writeContractFields(options)), 'Code review cancelled');
        }
        case 'submit-result': {
            if (!options.id)
                throw new Error('--id is required for code-review submit-result');
            const status = toNonEmptyString(options.status);
            if (status && status !== 'COMPLETED' && status !== 'FAILED') {
                throw new Error('--status must be COMPLETED or FAILED for code-review submit-result');
            }
            const findings = parseFindingsFile(options.findingsFile);
            const resultSummary = toNonEmptyString(options.resultSummary) ?? toNonEmptyString(readOptionalFile(options.resultSummaryFile));
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
            return withSpinner('Dismissing finding...', () => dismissCodeReviewFinding(apiUrl, projectId, headers, options.id, options.findingId, mutationContractFields(options)), 'Finding dismissed');
        }
        case 'resolve': {
            if (!options.id)
                throw new Error('--id is required for code-review resolve');
            const findingIds = parseFindingIdOptions(options, 'resolve');
            // 여러 finding은 finding마다 별개의 요청이라 하나의 멱등 키를 공유할 수 없다.
            // 두 번째 호출부터 같은 키 + 다른 요청 본문이 되어 서버가 키 재사용(409)으로 거절한다.
            if (options.idempotencyKey && findingIds.length > 1) {
                throw new Error('--idempotency-key applies to a single finding. Resolve one finding per call, or omit the key.');
            }
            // 동시성 토큰은 각 finding의 updatedAt에 대응한다. 하나를 여러 요청에 재사용하면
            // 앞선 resolve만 적용된 뒤 나머지가 409로 실패하는 부분 성공 상태가 생긴다.
            if (options.expectedUpdatedAt !== undefined && findingIds.length > 1) {
                throw new Error("--expected-updated-at applies to a single finding. Resolve one finding per call with that finding's updatedAt, or omit the timestamp.");
            }
            const contractFields = mutationContractFields(options);
            return withSpinner(findingIds.length === 1 ? 'Resolving finding...' : 'Resolving findings...', async () => {
                const results = [];
                for (const findingId of findingIds) {
                    results.push(await resolveCodeReviewFinding(apiUrl, projectId, headers, options.id, findingId, contractFields));
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
            return withSpinner('Restoring finding...', () => undismissCodeReviewFinding(apiUrl, projectId, headers, options.id, options.findingId, mutationContractFields(options)), 'Finding restored');
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=codeReview.js.map