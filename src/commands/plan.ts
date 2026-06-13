import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLAN_COMPLEXITY_ORDER } from '../constants/planComplexity.js';
import { checkConventionFreshness } from './convention.js';
import { findProjectConfig } from '../utils/config.js';
import { collectGitMetrics } from '../utils/git.js';
import { withSpinner, printFileInfo } from '../utils/spinner.js';
import { mergePlanWithDependencies, normalizeDependencies } from '../utils/planFormat.js';
import {
  ensureUrlProtocol,
  interpretEscapes,
  stripFrontmatter,
  toNonEmptyString,
  toNonNegativeInteger,
  toPositiveInteger,
  toSafeFileName,
  deleteIfTempFile,
  pruneStaleCacheFiles,
} from '../utils/parsers.js';
import { validatePlanPreviewHtmlSafety } from '../utils/planPreviewHtmlSafety.js';
import {
  assignPlan,
  createPlan,
  deletePlan,
  finishPlanLifecycle,
  getPlan,
  getPlanDependencies,
  getPlanStatus,
  linkOriginIssue,
  listOriginIssues,
  listPlans,
  patchPlanStatus,
  startPlanLifecycle,
  unlinkOriginIssue,
  updatePlan,
  uploadPlanHtml,
} from '../api/plan.js';

const PLAN_COMPLEXITY_VALUES: readonly string[] = PLAN_COMPLEXITY_ORDER;

// Lightweight, warning-only heuristic that flags an obvious mismatch between the declared
// complexity and the plan body length. It never rejects — precise structural validation is future work.
function warnOnComplexityMismatch(complexity: string, content: string): void {
  const length = content.trim().length;
  if (complexity === 'FULL' && length < 400) {
    process.stderr.write(
      '[warn] plan create: --complexity FULL but the body is short. FULL is for multi-wave / multi-domain work — confirm the tier fits.\n',
    );
  } else if (complexity === 'MINIMAL' && length > 4000) {
    process.stderr.write(
      '[warn] plan create: --complexity MINIMAL but the body is large. MINIMAL is for a single task touching 1–2 files — confirm the tier fits.\n',
    );
  }
}

function assertPlanPreviewHtmlSafety(html: string): void {
  const result = validatePlanPreviewHtmlSafety(html);
  if (!result.ok) {
    throw new Error(
      'Plan HTML preview is not theme-safe. ' + `Fix the preview before uploading: ${result.reasons.join('; ')}.`,
    );
  }
}

export function assertComplexityReasonCanBeRecorded(
  complexityReason: unknown,
  nextComplexity: string | undefined,
  currentComplexity?: string | null,
): void {
  if (!complexityReason) return;
  if (!nextComplexity) {
    throw new Error(
      '--complexity-reason requires --complexity. The reason is only recorded when complexity is updated.',
    );
  }
  if (currentComplexity === nextComplexity) {
    throw new Error(
      '--complexity-reason was provided, but --complexity matches the current plan complexity. Choose a different complexity or omit the reason.',
    );
  }
}

export const getPlanComplexityValues = (): readonly string[] => PLAN_COMPLEXITY_VALUES;

function findProjectRoot(): string | null {
  const configPath = findProjectConfig(process.cwd());
  if (!configPath) return null;
  return resolve(configPath, '..', '..');
}

function formatFreshnessChangeLabel(change: {
  type: 'new' | 'updated' | 'deleted';
  title?: string;
  fileName?: string;
  id: string;
}): string {
  const target =
    change.title && change.title.trim().length > 0
      ? change.title.trim()
      : change.fileName && change.fileName.trim().length > 0
        ? change.fileName.trim()
        : change.id;

  if (change.type === 'new') return `new: ${target}`;
  if (change.type === 'deleted') return `deleted: ${target}`;
  return `updated: ${target}`;
}

export function buildFreshnessNoticeLines(freshness: {
  platformGuidesChanged: boolean;
  conventionChanges: Array<{ type: 'new' | 'updated' | 'deleted'; title?: string; fileName?: string; id: string }>;
}): string[] {
  const lines: string[] = ['⚠ Updated conventions found:'];
  if (freshness.platformGuidesChanged) {
    lines.push('  - platform guides (shared)');
  }

  for (const change of freshness.conventionChanges) {
    lines.push(`  - ${formatFreshnessChangeLabel(change)}`);
  }

  return lines;
}

async function runFreshnessCheckSilent(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return;

  try {
    const freshness = await checkConventionFreshness(apiUrl, projectId, headers, projectRoot);
    const hasChanges = freshness.platformGuidesChanged || freshness.conventionChanges.length > 0;
    if (!hasChanges) return;

    const noticeLines = buildFreshnessNoticeLines(freshness);
    for (const line of noticeLines) {
      process.stderr.write(`${line}\n`);
    }
    process.stderr.write('Run agentteams convention download to sync latest conventions.\n');
  } catch (error) {
    void error;
  }
}

export function buildUniquePlanRunbookFileName(title: string, planId: string, existingFileNames: string[]): string {
  const idPrefix = planId.slice(0, 8);
  const safeName = toSafeFileName(title) || 'plan';
  const baseName = `${safeName}-${idPrefix}`;
  const used = new Set(existingFileNames.map((name) => name.toLowerCase()));

  let fileName = `${baseName}.md`;
  let sequence = 2;
  while (used.has(fileName.toLowerCase())) {
    fileName = `${baseName}-${sequence}.md`;
    sequence += 1;
  }

  return fileName;
}

export function readPlanHtmlUploadInput(options: { file?: string; stdin?: boolean }): string {
  const hasFile = typeof options.file === 'string' && options.file.trim().length > 0;
  const hasStdin = options.stdin === true;

  if (hasFile && hasStdin) {
    throw new Error('Use either --file or --stdin for plan upload-html, not both');
  }
  if (!hasFile && !hasStdin) {
    throw new Error('--file or --stdin is required for plan upload-html');
  }

  const html = hasFile
    ? (() => {
        const filePath = resolve(options.file as string);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        return readFileSync(filePath, 'utf-8');
      })()
    : readFileSync(0, 'utf-8');

  if (html.trim().length === 0) {
    throw new Error('HTML content is empty');
  }
  assertPlanPreviewHtmlSafety(html);

  return html;
}

export function hasPlanHtmlPreviewInput(options: { htmlFile?: string; htmlStdin?: boolean }): boolean {
  const hasFile = typeof options.htmlFile === 'string' && options.htmlFile.trim().length > 0;
  const hasStdin = options.htmlStdin === true;
  return hasFile || hasStdin;
}

export function readPlanHtmlPreviewInput(options: { htmlFile?: string; htmlStdin?: boolean }): string {
  const hasFile = typeof options.htmlFile === 'string' && options.htmlFile.trim().length > 0;
  const hasStdin = options.htmlStdin === true;

  if (hasFile && hasStdin) {
    throw new Error('Use either --html-file or --html-stdin for the plan HTML preview, not both');
  }
  if (!hasFile && !hasStdin) {
    throw new Error('--html-file or --html-stdin is required to provide the plan HTML preview');
  }

  const html = hasFile
    ? (() => {
        const filePath = resolve(options.htmlFile as string);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.htmlFile}`);
        }
        return readFileSync(filePath, 'utf-8');
      })()
    : readFileSync(0, 'utf-8');

  if (html.trim().length === 0) {
    throw new Error('HTML preview content is empty');
  }
  assertPlanPreviewHtmlSafety(html);

  return html;
}

async function uploadPlanHtmlPreview(
  apiUrl: string,
  projectId: string,
  headers: any,
  planId: string,
  html: string,
  sourceLabel: string | undefined,
  action: 'created' | 'updated',
): Promise<void> {
  try {
    await withSpinner(
      'Uploading plan HTML preview...',
      () =>
        uploadPlanHtml(apiUrl, projectId, headers, planId, {
          html,
          curationType: 'AI_CURATED',
          sourceLabel,
        }),
      'Plan HTML preview uploaded',
    );
  } catch (error: any) {
    const cause = error?.message ?? error;
    throw new Error(
      `Plan ${planId} was ${action}, but uploading the HTML preview failed (partial failure: the plan body and preview are now out of sync). ` +
        `Re-run 'agentteams plan upload-html --id ${planId} --file <html-file>' to finish. Cause: ${cause}`,
    );
  }
}

function minimalPlanRefactorChecklistTemplate(): string {
  return [
    '## Refactor Checklist',
    '- Define current pain points and target behavior',
    '- Identify impacted modules and side effects',
    '- Keep API/schema contracts backward-compatible',
    '- Add or update related tests',
    '- Run verification (`npm test`, `npm run build`) and record outcomes',
    '',
  ].join('\n');
}

function minimalPlanQuickTemplate(): string {
  return [
    '## TL;DR',
    '- Goal: {what will be done}',
    '- Out of scope: {what will NOT be done}',
    '- Done when: {how we verify completion}',
    '',
    '## Tasks',
    '- Implement the change',
    '- Update or add tests',
    '- Run verification (`npm test`, `npm run build`) and record outcomes',
    '',
  ].join('\n');
}

function resolvePlanTemplate(template: unknown): string | undefined {
  if (template === undefined || template === null) return undefined;
  const value = String(template).trim();
  if (value.length === 0) return undefined;

  if (value === 'refactor-minimal') return minimalPlanRefactorChecklistTemplate();
  if (value === 'quick-minimal') return minimalPlanQuickTemplate();

  throw new Error(`Unsupported plan template: ${value}. Only 'refactor-minimal' and 'quick-minimal' are supported.`);
}

// quick 플랜의 finish 응답({data:{...plan...}})에서 최종 상태를 안전하게 꺼낸다.
function extractPlanStatus(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return undefined;
  const status = (data as Record<string, unknown>).status;
  return typeof status === 'string' && status.length > 0 ? status : undefined;
}

// quick 플랜 결과 JSON. 기본 출력 포맷이 json이므로, 깊이 묻힌 최종 상태(DONE)와
// 다음 단계를 최상위에 노출해 한눈에 보이게 한다(quick은 생성 즉시 DONE → 다음은 report create).
export function buildQuickPlanResult(
  planId: string,
  createResult: unknown,
  finishResult: unknown,
): Record<string, unknown> {
  const status = extractPlanStatus(finishResult);
  return {
    message: `Quick plan completed (${planId})`,
    planId,
    ...(status ? { status } : {}),
    next: `agentteams report create --plan-id ${planId}`,
    create: createResult,
    finish: finishResult,
  };
}

export async function executePlanCommand(
  apiUrl: string,
  projectId: string,
  headers: any,
  action: string,
  options: any,
): Promise<any> {
  const root = findProjectRoot();
  if (root) pruneStaleCacheFiles(root);

  switch (action) {
    case 'list': {
      await runFreshnessCheckSilent(apiUrl, projectId, headers);

      const params: Record<string, string | number> = {};

      if (options.title) params.title = options.title;
      if (options.search) params.search = options.search;
      if (options.status) params.status = options.status;
      if (options.type) params.type = options.type;
      if (options.assignedTo) params.assignedTo = options.assignedTo;
      const page = toPositiveInteger(options.page);
      const pageSize = toPositiveInteger(options.pageSize);
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      return listPlans(apiUrl, projectId, headers, params);
    }
    case 'get': {
      if (!options.id) throw new Error('--id is required for plan get');
      await runFreshnessCheckSilent(apiUrl, projectId, headers);

      const response = await getPlan(apiUrl, projectId, headers, options.id);

      if (options.includeDeps) {
        const depsResponse = await getPlanDependencies(apiUrl, projectId, headers, options.id);
        const dependencies = normalizeDependencies(depsResponse);
        const mergedPlan = mergePlanWithDependencies(response, dependencies);

        return mergedPlan;
      }

      return response;
    }
    case 'show': {
      if (!options.id) throw new Error('--id is required for plan show');
      await runFreshnessCheckSilent(apiUrl, projectId, headers);

      const response = await getPlan(apiUrl, projectId, headers, options.id);

      if (options.includeDeps) {
        const depsResponse = await getPlanDependencies(apiUrl, projectId, headers, options.id);
        const dependencies = normalizeDependencies(depsResponse);
        const mergedPlan = mergePlanWithDependencies(response, dependencies);

        return mergedPlan;
      }

      return response;
    }
    case 'status': {
      if (!options.id) throw new Error('--id is required for plan status');
      return getPlanStatus(apiUrl, projectId, headers, options.id);
    }
    case 'set-status': {
      if (!options.id) throw new Error('--id is required for plan set-status');
      if (!options.status) throw new Error('--status is required for plan set-status');
      return patchPlanStatus(apiUrl, projectId, headers, options.id, options.status);
    }
    case 'upload-html': {
      if (!options.id) throw new Error('--id is required for plan upload-html');

      const html = readPlanHtmlUploadInput({ file: options.file, stdin: options.stdin });
      if (options.file) printFileInfo(options.file, html);

      return withSpinner(
        'Uploading plan HTML summary...',
        () =>
          uploadPlanHtml(apiUrl, projectId, headers, options.id, {
            html,
            curationType: 'AI_CURATED',
            sourceLabel: options.sourceLabel,
          }),
        'Plan HTML summary uploaded',
      );
    }
    case 'start': {
      if (!options.id) throw new Error('--id is required for plan start');
      const assignAgent = (options.agent as string | undefined) ?? (options.defaultCreatedBy as string | undefined);

      if (!assignAgent) {
        throw new Error('No agent available for assignment. Set AGENTTEAMS_AGENT_NAME or pass --agent.');
      }

      const startGitInfo = options.git === false ? {} : collectGitMetrics();

      const body: {
        assignedTo?: string;
        task?: string;
        startCommit?: string;
        startBranch?: string;
        runnerType?: string;
        model?: string;
        fastMode?: boolean;
      } = {
        assignedTo: assignAgent,
      };
      if (options.task) {
        body.task = options.task;
      }
      if (startGitInfo.commitHash) {
        body.startCommit = startGitInfo.commitHash;
      }
      if (startGitInfo.branchName) {
        body.startBranch = startGitInfo.branchName;
      }
      if (options.runnerType) {
        body.runnerType = options.runnerType;
      }
      if (options.model) {
        body.model = options.model;
      }
      if (options.fast === true) {
        body.fastMode = true;
      }

      const result = await withSpinner(
        'Starting plan...',
        () => startPlanLifecycle(apiUrl, projectId, headers, options.id, body),
        'Plan started',
      );
      process.stderr.write(`\n  Hint: Run 'agentteams plan download --id ${options.id}' to save the plan locally.\n`);
      return result;
    }
    case 'finish': {
      if (!options.id) throw new Error('--id is required for plan finish');

      let reportContent: string | undefined;

      if (options.reportFile) {
        const reportFilePath = resolve(options.reportFile);
        if (!existsSync(reportFilePath)) {
          throw new Error(`File not found: ${options.reportFile}`);
        }
        reportContent = readFileSync(reportFilePath, 'utf-8');
        printFileInfo(options.reportFile, reportContent);
      }

      const includeCompletionReport = typeof reportContent === 'string' && reportContent.trim().length > 0;

      // 완료보고서를 첨부하면 runnerType/model 스냅샷이 보고서에 저장되므로,
      // null로 남지 않도록 보고서 첨부 시점에 강제한다. (보고서 없는 finish는 제외)
      if (includeCompletionReport && (!options.runnerType || !options.model)) {
        throw new Error('--runner-type and --model are required when attaching a completion report.');
      }

      const body: {
        task?: string;
        runnerType?: string;
        model?: string;
        fastMode?: boolean;
        completionReport?: {
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
        };
      } = {};

      if (options.task) {
        body.task = options.task;
      }
      if (options.runnerType) {
        body.runnerType = options.runnerType;
      }
      if (options.model) {
        body.model = options.model;
      }
      if (options.fast === true) {
        body.fastMode = true;
      }

      if (includeCompletionReport) {
        // Fetch plan to get startCommit for accurate diff range
        let planStartCommit: string | undefined;
        if (options.git !== false) {
          try {
            const planResponse = await getPlan(apiUrl, projectId, headers, options.id);
            planStartCommit = planResponse?.data?.startCommit ?? undefined;
          } catch {
            // Plan fetch failure is non-blocking; fall back to HEAD~1 diff
          }
        }

        const autoGitMetrics =
          options.git === false ? {} : collectGitMetrics(undefined, { startCommit: planStartCommit });

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
        const reportStatus = toNonEmptyString(options.reportStatus);
        const reviewRecommendationRaw = toNonEmptyString(options.reviewRecommendation);
        const reviewRecommendation =
          reviewRecommendationRaw === 'REQUIRED' || reviewRecommendationRaw === 'NOT_NEEDED'
            ? reviewRecommendationRaw
            : reviewRecommendationRaw !== undefined
              ? (() => {
                  console.warn(
                    `Ignoring invalid --review-recommendation "${reviewRecommendationRaw}" (expected REQUIRED or NOT_NEEDED)`,
                  );
                  return undefined;
                })()
              : undefined;
        const reviewReason = toNonEmptyString(options.reviewReason);

        const reportTitle =
          typeof options.reportTitle === 'string' && options.reportTitle.trim().length > 0
            ? options.reportTitle.trim()
            : (() => {
                throw new Error('--report-title is required when attaching a completion report');
              })();

        body.completionReport = {
          title: reportTitle,
          content: reportContent!.trim(),
        };

        if (reportStatus !== undefined) body.completionReport.status = reportStatus;
        if (qualityScore !== undefined) body.completionReport.qualityScore = qualityScore;
        if (commitHash !== undefined) body.completionReport.commitHash = commitHash;
        if (branchName !== undefined) body.completionReport.branchName = branchName;
        if (filesModified !== undefined) body.completionReport.filesModified = filesModified;
        if (linesAdded !== undefined) body.completionReport.linesAdded = linesAdded;
        if (linesDeleted !== undefined) body.completionReport.linesDeleted = linesDeleted;
        if (durationSeconds !== undefined) body.completionReport.durationSeconds = durationSeconds;
        if (commitStart !== undefined) body.completionReport.commitStart = commitStart;
        if (commitEnd !== undefined) body.completionReport.commitEnd = commitEnd;
        if (pullRequestId !== undefined) body.completionReport.pullRequestId = pullRequestId;
        if (reviewRecommendation !== undefined) body.completionReport.reviewRecommendation = reviewRecommendation;
        if (reviewReason !== undefined) body.completionReport.reviewReason = reviewReason;
      }

      const finishResult = await withSpinner(
        'Finishing plan...',
        () => finishPlanLifecycle(apiUrl, projectId, headers, options.id, body),
        'Plan finished',
      );
      if (options.reportFile) deleteIfTempFile(options.reportFile, { keep: options.keepTemp });
      return finishResult;
    }
    case 'create': {
      if (!options.title) throw new Error('--title is required for plan create');
      if (!options.runnerType || !options.model) {
        throw new Error('--runner-type and --model are required for plan create.');
      }
      if (!options.complexity) {
        throw new Error('--complexity is required for plan create. Choose one of MINIMAL, STANDARD, FULL.');
      }
      const createComplexity = String(options.complexity).toUpperCase();
      if (!PLAN_COMPLEXITY_VALUES.includes(createComplexity)) {
        throw new Error(
          `Invalid --complexity "${options.complexity}". Choose one of ${PLAN_COMPLEXITY_VALUES.join(', ')}.`,
        );
      }

      let content = options.content;
      const hasExplicitContent = typeof options.content === 'string' && options.content.trim().length > 0;
      const hasExplicitFile = typeof options.file === 'string' && options.file.trim().length > 0;
      const templateContent = resolvePlanTemplate(options.template);

      if (!content && !options.file && templateContent) {
        content = templateContent;
      }

      if ((hasExplicitContent || hasExplicitFile) && templateContent) {
        process.stderr.write('[warn] plan create: --template is ignored because --content/--file was provided.\n');
      }

      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = stripFrontmatter(readFileSync(filePath, 'utf-8'));
        printFileInfo(options.file, content);
      }
      if (typeof content === 'string' && options.interpretEscapes) {
        content = interpretEscapes(content);
      }
      if (!content || content.trim().length === 0) {
        throw new Error('--content, --file, or --template is required for plan create');
      }

      if (options.status && options.status !== 'BACKLOG') {
        process.stderr.write(
          `[warn] plan create: --status ${options.status} is ignored. Plans are always created as BACKLOG.\n`,
        );
      }

      // HTML preview is mandatory for plan create — there is no escape hatch. This keeps the
      // plan body and its human-facing preview in sync.
      const createHasHtmlInput = hasPlanHtmlPreviewInput(options);
      if (!createHasHtmlInput) {
        throw new Error('An HTML preview is required for plan create. Provide --html-file <path> or --html-stdin.');
      }
      const createHtmlContent = readPlanHtmlPreviewInput(options);

      // Lightweight complexity sanity check (warning only). A FULL plan body should look multi-wave;
      // a MINIMAL one should be short and single-scoped. This nudges authors toward the right tier
      // without rejecting the create.
      warnOnComplexityMismatch(createComplexity, content);

      const createResult = await withSpinner(
        'Creating plan...',
        () =>
          createPlan(apiUrl, projectId, headers, {
            title: options.title,
            content,
            type: options.type,
            complexity: createComplexity,
            priority: options.priority ?? 'MEDIUM',
            repositoryId: options.repositoryId ?? options.defaultRepositoryId,
            status: 'BACKLOG',
            runnerType: options.runnerType,
            model: options.model,
            fastMode: options.fast === true,
            kind: 'NORMAL',
          }),
        'Plan created',
      );
      if (options.file) deleteIfTempFile(options.file, { keep: options.keepTemp });

      const createdPlanId: string | undefined = createResult?.data?.id;
      if (createHtmlContent && createdPlanId) {
        await uploadPlanHtmlPreview(
          apiUrl,
          projectId,
          headers,
          createdPlanId,
          createHtmlContent,
          options.sourceLabel,
          'created',
        );
        if (options.htmlFile) deleteIfTempFile(options.htmlFile, { keep: options.keepTemp });
      }

      // --origin-issue flag: link origin issues after plan creation
      const originIssueFlags: string[] = Array.isArray(options.originIssue)
        ? options.originIssue
        : options.originIssue
          ? [options.originIssue]
          : [];

      if (originIssueFlags.length > 0 && createResult?.data?.id) {
        const createdPlanId = createResult.data.id;
        for (const raw of originIssueFlags) {
          // Format: PROVIDER:EXTERNAL_ID:URL[:TITLE]
          // Use first colon to get provider, second to get externalId, rest is URL[:TITLE]
          const firstColon = raw.indexOf(':');
          const secondColon = raw.indexOf(':', firstColon + 1);
          if (firstColon < 0 || secondColon < 0) {
            process.stderr.write(
              `[warn] Skipping invalid --origin-issue: "${raw}" (expected provider:externalId:externalUrl[:title])\n`,
            );
            continue;
          }
          const provider = raw.substring(0, firstColon);
          const externalId = raw.substring(firstColon + 1, secondColon);
          const remainder = raw.substring(secondColon + 1);

          // Title is optional, separated by the last colon that's NOT part of a URL path
          // URL always contains "://" so find the scheme separator, then look for trailing :title
          let externalUrl: string;
          let externalTitle: string | undefined;
          const schemeEnd = remainder.indexOf('://');
          if (schemeEnd >= 0) {
            // Find last colon after the scheme
            const afterScheme = schemeEnd + 3;
            const lastColon = remainder.lastIndexOf(':');
            if (lastColon > afterScheme) {
              externalUrl = remainder.substring(0, lastColon);
              externalTitle = remainder.substring(lastColon + 1) || undefined;
            } else {
              externalUrl = remainder;
            }
          } else {
            externalUrl = remainder;
          }

          try {
            await linkOriginIssue(apiUrl, projectId, headers, createdPlanId, {
              provider: provider.toUpperCase(),
              externalId,
              externalUrl: ensureUrlProtocol(externalUrl),
              externalTitle,
            });
          } catch (err: any) {
            // 409 CONFLICT = already linked, skip silently
            if (err?.response?.status !== 409) {
              process.stderr.write(
                `[warn] Failed to link origin issue (${provider}:${externalId}): ${err?.message ?? err}\n`,
              );
            }
          }
        }
      }

      return createResult;
    }
    case 'update': {
      if (!options.id) throw new Error('--id is required for plan update');
      const body: Record<string, string> = {};
      if (options.title) body.title = options.title;
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        body.content = stripFrontmatter(readFileSync(filePath, 'utf-8'));
        printFileInfo(options.file, body.content);
      } else if (options.content) {
        body.content = options.content;
        if (typeof body.content === 'string' && options.interpretEscapes) {
          body.content = interpretEscapes(body.content);
        }
      }
      if (options.status) body.status = options.status;
      if (options.type) body.type = options.type;
      if (options.priority) body.priority = options.priority;
      assertComplexityReasonCanBeRecorded(
        options.complexityReason,
        options.complexity ? String(options.complexity).toUpperCase() : undefined,
      );
      if (options.complexity) {
        const updateComplexity = String(options.complexity).toUpperCase();
        if (!PLAN_COMPLEXITY_VALUES.includes(updateComplexity)) {
          throw new Error(
            `Invalid --complexity "${options.complexity}". Choose one of ${PLAN_COMPLEXITY_VALUES.join(', ')}.`,
          );
        }
        body.complexity = updateComplexity;
      }
      if (options.complexityReason) {
        if (typeof body.complexity === 'string') {
          const currentPlan = await getPlan(apiUrl, projectId, headers, options.id);
          const currentComplexity = currentPlan?.data?.complexity;
          assertComplexityReasonCanBeRecorded(options.complexityReason, body.complexity, currentComplexity);
        }
        body.complexityChangeReason = options.complexityReason;
      }

      // Preview-affecting fields mirror the source hash inputs (title, type, priority, content).
      // A status-only or complexity-only change does not affect the preview, so the HTML preview is not required.
      const previewAffecting =
        typeof body.content === 'string' ||
        typeof body.title === 'string' ||
        typeof body.type === 'string' ||
        typeof body.priority === 'string';

      const updateHasHtmlInput = hasPlanHtmlPreviewInput(options);
      if (previewAffecting && !updateHasHtmlInput) {
        throw new Error(
          'An HTML preview is required when updating the plan body, title, type, or priority. ' +
            'Provide --html-file <path> or --html-stdin.',
        );
      }
      const updateHtmlContent = updateHasHtmlInput ? readPlanHtmlPreviewInput(options) : undefined;

      const updateResult = await withSpinner(
        'Updating plan...',
        () => updatePlan(apiUrl, projectId, headers, options.id, body),
        'Plan updated',
      );
      if (options.file) deleteIfTempFile(options.file, { keep: options.keepTemp });

      if (updateHtmlContent) {
        await uploadPlanHtmlPreview(
          apiUrl,
          projectId,
          headers,
          options.id,
          updateHtmlContent,
          options.sourceLabel,
          'updated',
        );
        if (options.htmlFile) deleteIfTempFile(options.htmlFile, { keep: options.keepTemp });
      }

      return updateResult;
    }
    case 'delete': {
      if (!options.id) throw new Error('--id is required for plan delete');
      await deletePlan(apiUrl, projectId, headers, options.id);
      return { message: `Plan ${options.id} deleted successfully` };
    }
    case 'assign': {
      if (!options.id) throw new Error('--id is required for plan assign');
      if (!options.agent) throw new Error('--agent is required for plan assign');
      return assignPlan(apiUrl, projectId, headers, options.id, options.agent);
    }
    case 'download': {
      if (!options.id) throw new Error('--id is required for plan download');
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        throw new Error("Project root not found. Run 'agentteams init' first.");
      }

      const result = await withSpinner(
        'Downloading plan...',
        async () => {
          const response = await getPlan(apiUrl, projectId, headers, options.id);
          const plan = response.data;

          const activePlanDir = join(projectRoot, '.agentteams', 'cli', 'active-plan');
          if (!existsSync(activePlanDir)) {
            mkdirSync(activePlanDir, { recursive: true });
          }

          const existingFiles = readdirSync(activePlanDir).filter((name) => name.endsWith('.md'));
          for (const existing of existingFiles) {
            const existingPath = join(activePlanDir, existing);
            const content = readFileSync(existingPath, 'utf-8');
            const match = content.match(/^planId:\s*(.+)$/m);
            if (match && match[1].trim() === plan.id) {
              rmSync(existingPath);
            }
          }
          const remainingFiles = readdirSync(activePlanDir).filter((name) => name.endsWith('.md'));
          const fileName = buildUniquePlanRunbookFileName(plan.title, plan.id, remainingFiles);
          const filePath = join(activePlanDir, fileName);

          const frontmatter = [
            '---',
            `planId: ${plan.id}`,
            `title: ${plan.title}`,
            `status: ${plan.status}`,
            `priority: ${plan.priority}`,
            plan.webUrl ? `webUrl: ${plan.webUrl}` : null,
            `downloadedAt: ${new Date().toISOString()}`,
            '---',
          ]
            .filter(Boolean)
            .join('\n');

          const markdown = plan.contentMarkdown ?? '';
          writeFileSync(filePath, `${frontmatter}\n\n${markdown}`, 'utf-8');

          return {
            message: `Plan downloaded to ${fileName}`,
            filePath: `.agentteams/cli/active-plan/${fileName}`,
          };
        },
        'Plan downloaded',
      );

      return result;
    }
    case 'cleanup': {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        throw new Error("Project root not found. Run 'agentteams init' first.");
      }

      const activePlanDir = join(projectRoot, '.agentteams', 'cli', 'active-plan');
      if (!existsSync(activePlanDir)) {
        return { message: 'No active-plan directory found.', deletedFiles: [] };
      }

      const deletedFiles = await withSpinner(
        'Cleaning up plan files...',
        async () => {
          const allFiles = readdirSync(activePlanDir).filter((f) => f.endsWith('.md'));
          const deleted: string[] = [];

          if (options.id) {
            for (const file of allFiles) {
              const content = readFileSync(join(activePlanDir, file), 'utf-8');
              const match = content.match(/^planId:\s*(.+)$/m);
              if (match && match[1].trim() === options.id) {
                rmSync(join(activePlanDir, file));
                deleted.push(file);
              }
            }
          } else {
            for (const file of allFiles) {
              rmSync(join(activePlanDir, file));
              deleted.push(file);
            }
          }

          return deleted;
        },
        'Cleaned up plan files',
      );

      return {
        message: deletedFiles.length > 0 ? `Deleted ${deletedFiles.length} file(s).` : 'No matching files found.',
        deletedFiles,
      };
    }
    case 'quick': {
      if (!options.title) throw new Error('--title is required for plan quick');
      if (!options.runnerType || !options.model) {
        throw new Error('--runner-type and --model are required for plan quick.');
      }

      const assignAgent = (options.agent as string | undefined) ?? (options.defaultCreatedBy as string | undefined);
      if (!assignAgent) {
        throw new Error('No agent available for assignment. Set AGENTTEAMS_AGENT_NAME or pass --agent.');
      }

      // Resolve plan content: --content > --file > template fallback
      let planContent: string | undefined = undefined;
      const hasQuickContent = typeof options.content === 'string' && options.content.trim().length > 0;
      const hasQuickFile = typeof options.file === 'string' && options.file.trim().length > 0;

      if (hasQuickContent) {
        planContent = options.content as string;
      } else if (hasQuickFile) {
        const filePath = resolve(options.file as string);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        planContent = stripFrontmatter(readFileSync(filePath, 'utf-8'));
        printFileInfo(options.file as string, planContent);
      } else {
        throw new Error(
          '--content or --file is required for plan quick. Provide the actual work description instead of using a template.',
        );
      }

      if (typeof planContent === 'string' && options.interpretEscapes) {
        planContent = interpretEscapes(planContent);
      }

      const priority = (options.priority as string | undefined) ?? 'LOW';

      // Quick plans are one-shot, small-scope work, so they default to MINIMAL unless overridden.
      const quickComplexity = options.complexity ? String(options.complexity).toUpperCase() : 'MINIMAL';
      if (!PLAN_COMPLEXITY_VALUES.includes(quickComplexity)) {
        throw new Error(
          `Invalid --complexity "${options.complexity}". Choose one of ${PLAN_COMPLEXITY_VALUES.join(', ')}.`,
        );
      }

      // 1. Create plan
      const createResult = await withSpinner(
        'Creating quick plan...',
        () =>
          createPlan(apiUrl, projectId, headers, {
            title: options.title,
            content: planContent,
            type: options.type,
            complexity: quickComplexity,
            priority,
            repositoryId: options.repositoryId ?? options.defaultRepositoryId,
            status: 'BACKLOG',
            runnerType: options.runnerType,
            model: options.model,
            fastMode: options.fast === true,
            kind: 'QUICK',
          }),
        'Plan created',
      );
      if (hasQuickFile) deleteIfTempFile(options.file as string, { keep: options.keepTemp });

      const planId: string = createResult?.data?.id;
      if (!planId) {
        throw new Error('Failed to create plan: no plan ID returned.');
      }

      // 2. Start plan
      await withSpinner(
        'Starting plan...',
        () =>
          startPlanLifecycle(apiUrl, projectId, headers, planId, {
            assignedTo: assignAgent,
            runnerType: options.runnerType,
            model: options.model,
            fastMode: options.fast === true,
          }),
        'Plan started',
      );

      // 3. Finish plan (no completion report for quick plans)
      const finishResult = await withSpinner(
        'Finishing plan...',
        () =>
          finishPlanLifecycle(apiUrl, projectId, headers, planId, {
            runnerType: options.runnerType,
            model: options.model,
          }),
        'Plan finished',
      );

      return buildQuickPlanResult(planId, createResult, finishResult);
    }
    case 'link-issue': {
      const planId = toNonEmptyString(options.id);
      if (!planId) throw new Error('--id is required for plan link-issue');
      const provider = toNonEmptyString(options.provider)?.toUpperCase();
      if (!provider) throw new Error('--provider is required for plan link-issue');
      const externalId = toNonEmptyString(options.externalId);
      if (!externalId) throw new Error('--external-id is required for plan link-issue');
      const externalUrl = toNonEmptyString(options.externalUrl);
      if (!externalUrl) throw new Error('--external-url is required for plan link-issue');

      if (!['GITHUB', 'GITLAB', 'LINEAR'].includes(provider)) {
        throw new Error('--provider must be one of: GITHUB, GITLAB, LINEAR');
      }

      const body: {
        provider: string;
        externalId: string;
        externalUrl: string;
        externalTitle?: string;
        metadata?: Record<string, unknown>;
      } = { provider, externalId, externalUrl: ensureUrlProtocol(externalUrl) };

      if (options.title) body.externalTitle = options.title;
      if (options.metadata) {
        try {
          body.metadata = JSON.parse(options.metadata);
        } catch {
          throw new Error('--metadata must be valid JSON');
        }
      }

      return linkOriginIssue(apiUrl, projectId, headers, planId, body);
    }
    case 'unlink-issue': {
      const planId = toNonEmptyString(options.id);
      if (!planId) throw new Error('--id is required for plan unlink-issue');
      const issueId = toNonEmptyString(options.issueId);
      if (!issueId) throw new Error('--issue-id is required for plan unlink-issue');

      return unlinkOriginIssue(apiUrl, projectId, headers, planId, issueId);
    }
    case 'list-issues': {
      const planId = toNonEmptyString(options.id);
      if (!planId) throw new Error('--id is required for plan list-issues');

      return listOriginIssues(apiUrl, projectId, headers, planId);
    }
    case 'issue': {
      // Shorter alias for link-issue, designed for agent convenience
      const planId = toNonEmptyString(options.id);
      if (!planId) throw new Error('--id is required for plan issue');
      const provider = toNonEmptyString(options.provider)?.toUpperCase();
      if (!provider) throw new Error('--provider is required for plan issue');
      const externalId = toNonEmptyString(options.externalId);
      if (!externalId) throw new Error('--external-id is required for plan issue');
      const externalUrl = toNonEmptyString(options.externalUrl);
      if (!externalUrl) throw new Error('--external-url is required for plan issue');

      if (!['GITHUB', 'GITLAB', 'LINEAR'].includes(provider)) {
        throw new Error('--provider must be one of: GITHUB, GITLAB, LINEAR');
      }

      const body: {
        provider: string;
        externalId: string;
        externalUrl: string;
        externalTitle?: string;
        metadata?: Record<string, unknown>;
      } = { provider, externalId, externalUrl: ensureUrlProtocol(externalUrl) };

      if (options.title) body.externalTitle = options.title;
      if (options.metadata) {
        try {
          body.metadata = JSON.parse(options.metadata);
        } catch {
          throw new Error('--metadata must be valid JSON');
        }
      }

      try {
        return await linkOriginIssue(apiUrl, projectId, headers, planId, body);
      } catch (err: any) {
        // 409 CONFLICT = already linked, return success message
        if (err?.response?.status === 409) {
          return { message: 'Origin issue already linked (skipped)' };
        }
        throw err;
      }
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
