import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCodeReview, createPlanFromCodeReview, getCodeReview, listCodeReviews } from '../api/codeReview.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
import { withSpinner } from '../utils/spinner.js';

const parseCsv = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
};

const readOptionalFile = (file: unknown): string | undefined => {
  if (typeof file !== 'string' || file.trim().length === 0) return undefined;
  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${file}`);
  }
  return readFileSync(filePath, 'utf-8');
};

const FINDING_REQUIRED_FIELDS = ['severity', 'title', 'filePath', 'problem', 'impact', 'suggestion'] as const;

const parseFindingsFile = (file: unknown): Array<Record<string, unknown>> | undefined => {
  const raw = readOptionalFile(file);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
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
      const value = (item as Record<string, unknown>)[field];
      if (value === undefined || value === null || value === '') {
        throw new Error(`findings[${index}] missing required field: ${field}`);
      }
    }
  });

  return parsed as Array<Record<string, unknown>>;
};

export async function executeCodeReviewCommand(
  apiUrl: string,
  projectId: string,
  headers: any,
  action: string,
  options: any
): Promise<any> {
  switch (action) {
    case 'list': {
      const params: Record<string, string | number> = {};
      if (options.search) params.search = options.search;
      if (options.status) params.status = options.status;
      if (options.targetType) params.targetType = options.targetType;
      if (options.sourcePlanId) params.sourcePlanId = options.sourcePlanId;
      if (options.sourceCompletionReportId) params.sourceCompletionReportId = options.sourceCompletionReportId;

      const page = toPositiveInteger(options.page);
      const pageSize = toPositiveInteger(options.pageSize);
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      return listCodeReviews(apiUrl, projectId, headers, params);
    }
    case 'get':
    case 'show': {
      if (!options.id) throw new Error('--id is required for code-review get');
      return getCodeReview(apiUrl, projectId, headers, options.id);
    }
    case 'create': {
      const title = toNonEmptyString(options.title);
      if (!title) throw new Error('--title is required for code-review create');
      const runnerType = toNonEmptyString(options.runnerType);
      const model = toNonEmptyString(options.model);
      if (!runnerType || !model) {
        throw new Error('--runner-type and --model are required for code-review create');
      }

      const targetType = toNonEmptyString(options.targetType) ?? 'LOCAL_DIFF';
      const diffSummary = toNonEmptyString(options.diffSummary) ?? readOptionalFile(options.diffFile);
      const testSummary = toNonEmptyString(options.testSummary) ?? readOptionalFile(options.testFile);
      const findings = parseFindingsFile(options.findingsFile);

      const body: Record<string, unknown> = {
        title,
        targetType
      };
      if (options.repositoryId) body.repositoryId = options.repositoryId;
      if (options.targetRef) body.targetRef = options.targetRef;
      if (options.sourcePlanId) body.sourcePlanId = options.sourcePlanId;
      if (options.sourceCompletionReportId) body.sourceCompletionReportId = options.sourceCompletionReportId;
      if (options.sourceCommitStart) body.sourceCommitStart = options.sourceCommitStart;
      if (options.sourceCommitEnd) body.sourceCommitEnd = options.sourceCommitEnd;
      if (options.sourceBranchName) body.sourceBranchName = options.sourceBranchName;
      if (options.baseBranchName) body.baseBranchName = options.baseBranchName;
      if (diffSummary) body.diffSummary = diffSummary;
      if (testSummary) body.testSummary = testSummary;
      if (options.reviewerContext) body.reviewerContext = options.reviewerContext;
      body.runnerType = runnerType;
      body.model = model;
      if (options.recommendationReason) body.recommendationReason = options.recommendationReason;
      if (findings !== undefined) body.findings = findings;

      return withSpinner(
        'Creating code review...',
        () => createCodeReview(apiUrl, projectId, headers, body),
        'Code review created',
      );
    }
    case 'create-plan': {
      if (!options.id) throw new Error('--id is required for code-review create-plan');
      const title = toNonEmptyString(options.title);
      if (!title) throw new Error('--title is required for code-review create-plan');
      const findingIds = parseCsv(options.findingIds);
      if (findingIds.length === 0) {
        throw new Error('--finding-ids is required for code-review create-plan');
      }

      return withSpinner(
        'Creating plan from selected findings...',
        () => createPlanFromCodeReview(apiUrl, projectId, headers, options.id, {
          title,
          findingIds,
          priority: options.priority,
          type: options.type,
          runnerType: options.runnerType,
          model: options.model,
        }),
        'Plan created',
      );
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
