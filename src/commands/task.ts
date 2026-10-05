import {
  finishPlanTask,
  getPlanTask,
  startPlanTask,
  type PlanTaskFinishGit,
  type PlanTaskFinishReportAttachment,
} from '../api/task.js';
import { EXECUTION_SNAPSHOT_HINT, resolveExecutionSnapshot } from '../utils/agentIdentity.js';
import { stripEntityIdPrefix } from '../utils/entityId.js';
import { collectGitMetrics, collectTaskFinishGitSnapshot, getGitRemoteOriginUrl } from '../utils/git.js';
import { deleteIfTempFile, toNonNegativeInteger } from '../utils/parsers.js';
import { parseReviewRecommendation, readReportFile } from '../utils/report.js';

const FINISH_STATUSES = new Set(['DONE', 'BLOCKED', 'SKIPPED']);
const UNPUSHED_HEAD_WARNING =
  'HEAD commit is not on any remote branch. Push before another runner continues this plan.';
// 구버전 API는 모르는 바디 필드를 조용히 버리므로(ajv removeAdditional) 태스크만 끝나고 보고서는 생기지 않는다.
const TASK_REPORT_NOT_CREATED_WARNING =
  'The task was finished, but the server did not create a task report. It may not support --report-file yet.';

// 보고서 상태를 지정하지 않았을 때 태스크 종료 상태에서 파생한다. --status(태스크 상태)를 그대로 보내지 않는다.
const TASK_REPORT_STATUS_BY_FINISH_STATUS: Record<string, string> = {
  DONE: 'COMPLETED',
  BLOCKED: 'PARTIAL',
  SKIPPED: 'COMPLETED',
};

export type TaskCommandDependencies = {
  collectTaskFinishGitSnapshot?: typeof collectTaskFinishGitSnapshot;
  collectGitMetrics?: typeof collectGitMetrics;
  getGitRemoteOriginUrl?: typeof getGitRemoteOriginUrl;
  env?: NodeJS.ProcessEnv;
};

const toNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const toResultObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * task finish에 붙일 태스크 보고서를 만든다. --report-file이 없으면 undefined.
 *
 * 태스크에는 시작 커밋 기록이 없으므로 라인·파일 수는 --commit-start가 있을 때만 잰다.
 * 없을 때 HEAD~1로 재면 마지막 커밋 1개만 집계된 값이 사실처럼 저장된다.
 */
function buildTaskReportAttachment(
  options: Record<string, unknown>,
  finishStatus: string,
  snapshot: PlanTaskFinishGit | null,
  deps: TaskCommandDependencies,
): PlanTaskFinishReportAttachment | undefined {
  if (options.reportFile === undefined) return undefined;
  const reportFile = toNonEmptyString(options.reportFile);
  if (!reportFile) {
    throw new Error('--report-file requires a non-empty path to a completion report file.');
  }

  const execution = resolveExecutionSnapshot(options, deps.env);
  if (!execution.runnerType || !execution.model) {
    throw new Error(
      '--runner-type and --model are required when attaching a completion report.' + EXECUTION_SNAPSHOT_HINT,
    );
  }

  const content = readReportFile(reportFile);
  const completionReport: PlanTaskFinishReportAttachment['completionReport'] = {
    content,
    status: toNonEmptyString(options.reportStatus)?.toUpperCase() ?? TASK_REPORT_STATUS_BY_FINISH_STATUS[finishStatus],
  };

  const title = toNonEmptyString(options.reportTitle);
  if (title) completionReport.title = title;
  const qualityScore = toNonNegativeInteger(options.qualityScore);
  if (qualityScore !== undefined) completionReport.qualityScore = qualityScore;
  const reviewRecommendation = parseReviewRecommendation(options.reviewRecommendation);
  if (reviewRecommendation) completionReport.reviewRecommendation = reviewRecommendation;
  const reviewReason = toNonEmptyString(options.reviewReason);
  if (reviewReason) completionReport.reviewReason = reviewReason;

  if (snapshot) {
    completionReport.commitHash = snapshot.commit;
    completionReport.commitEnd = snapshot.commit;
    if (snapshot.branch) completionReport.branchName = snapshot.branch;
  }
  const commitStart = toNonEmptyString(options.commitStart);
  if (commitStart) {
    completionReport.commitStart = commitStart;
    if (options.git !== false) {
      const metrics = (deps.collectGitMetrics ?? collectGitMetrics)(undefined, { startCommit: commitStart });
      if (metrics.filesModified !== undefined) completionReport.filesModified = metrics.filesModified;
      if (metrics.linesAdded !== undefined) completionReport.linesAdded = metrics.linesAdded;
      if (metrics.linesDeleted !== undefined) completionReport.linesDeleted = metrics.linesDeleted;
    }
  }
  if (options.git !== false) {
    const repositoryRemoteUrl = (deps.getGitRemoteOriginUrl ?? getGitRemoteOriginUrl)();
    if (repositoryRemoteUrl) completionReport.repositoryRemoteUrl = repositoryRemoteUrl;
  }

  return {
    completionReport,
    runnerType: execution.runnerType,
    model: execution.model,
    ...(execution.fastMode ? { fastMode: true } : {}),
  };
}

export async function executeTaskCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>,
  deps: TaskCommandDependencies = {},
): Promise<unknown> {
  const planId = stripEntityIdPrefix(toNonEmptyString(options.planId));
  const taskId = stripEntityIdPrefix(toNonEmptyString(options.taskId));
  if (!taskId) throw new Error('--task-id is required for task commands');

  // get(단건 포커스)는 bare agentteams_tsk_<id> 핸드오프를 지원하므로 --plan-id가 선택이다.
  // 있으면 부모 일치로 좁힌다. 실행 뮤테이션(start/finish)은 부모 planId가 필수다.
  if (action === 'get') {
    return getPlanTask(apiUrl, projectId, headers, taskId, planId);
  }

  if (!planId) throw new Error('--plan-id is required for task commands');

  switch (action) {
    case 'start': {
      const result = await startPlanTask(apiUrl, projectId, headers, planId, taskId);
      return {
        message: `Task started (${taskId})`,
        planId,
        taskId,
        ...toResultObject(result),
      };
    }
    case 'finish': {
      const status = toNonEmptyString(options.status)?.toUpperCase();
      if (!status) throw new Error('--status is required for task finish');
      if (!FINISH_STATUSES.has(status)) {
        throw new Error('--status must be one of DONE, BLOCKED, or SKIPPED for task finish');
      }

      const snapshot =
        options.git === false ? null : (deps.collectTaskFinishGitSnapshot ?? collectTaskFinishGitSnapshot)();
      const report = buildTaskReportAttachment(options, status, snapshot, deps);
      const result = await finishPlanTask(
        apiUrl,
        projectId,
        headers,
        planId,
        taskId,
        status,
        snapshot ?? undefined,
        report,
      );
      const createdReport = toResultObject(toResultObject(toResultObject(result).data).completionReport);
      const reportCreated = toNonEmptyString(createdReport.id) !== undefined;
      if (report && reportCreated) {
        deleteIfTempFile(options.reportFile as string, { keep: options.keepTemp === true });
      }
      const payload: Record<string, unknown> = {
        message: `Task finished (${taskId}: ${status})`,
        planId,
        taskId,
        status,
        ...toResultObject(result),
      };
      const warnings: string[] = [];
      if (reportCreated && typeof createdReport.webUrl === 'string') {
        payload.message = `Task finished (${taskId}: ${status}) with report "${String(createdReport.title)}"`;
        payload.webUrl = createdReport.webUrl;
      } else if (report && !reportCreated) {
        warnings.push(
          `${TASK_REPORT_NOT_CREATED_WARNING} The report file was preserved at: ${String(options.reportFile)}`,
        );
      }
      if (snapshot?.commitOnRemote === false) {
        warnings.push(UNPUSHED_HEAD_WARNING);
      }
      if (warnings.length > 0) {
        payload.warning = warnings.join(' ');
        for (const warning of warnings) console.error(`Warning: ${warning}`);
      }
      return payload;
    }
    default:
      throw new Error('Unknown task action: ' + action + '. Use get, start, or finish.');
  }
}
