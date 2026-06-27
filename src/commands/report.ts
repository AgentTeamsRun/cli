import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createReport, deleteReport, getReport, listReports, updateReport } from '../api/report.js';
import { findProjectConfig } from '../utils/config.js';
import { getGitRemoteOriginUrl } from '../utils/git.js';
import { parseReportOptions } from '../utils/report.js';

import {
  deleteIfTempFile,
  pruneStaleCacheFiles,
  toNonEmptyString,
  toNonNegativeInteger,
  toPositiveInteger,
  toSafeFileName,
} from '../utils/parsers.js';
import { printFileInfo, withSpinner } from '../utils/spinner.js';

export async function executeReportCommand(apiUrl: string, headers: any, action: string, options: any): Promise<any> {
  if (!options.projectId || typeof options.projectId !== 'string') {
    throw new Error('--project-id is required (or configure AGENTTEAMS_PROJECT_ID / .agentteams/config.json)');
  }

  const configPath = findProjectConfig(process.cwd());
  if (configPath) pruneStaleCacheFiles(resolve(configPath, '..', '..'));

  switch (action) {
    case 'list': {
      const params: Record<string, string | number> = {};
      if (options.planId) params.planId = options.planId;
      if (options.status) params.status = options.status;
      if (options.search) params.search = options.search;

      const page = toPositiveInteger(options.page);
      const limitVal = toPositiveInteger(options.limit);
      const pageSizeVal = toPositiveInteger(options.pageSize);
      if (limitVal !== undefined && pageSizeVal !== undefined) {
        process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
      }
      const pageSize = limitVal ?? pageSizeVal;
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      return listReports(apiUrl, options.projectId, headers, params);
    }
    case 'get': {
      if (!options.id) throw new Error('--id is required for report get');
      return getReport(apiUrl, options.projectId, headers, options.id);
    }
    case 'create': {
      // 완료보고서는 항상 plan에 종속된다. plan 없이 빠르게 기록하려면 `agentteams plan quick`(퀵로그)를 사용한다.
      if (!toNonEmptyString(options.planId)) {
        throw new Error(
          '--plan-id is required for report create. A completion report must be linked to a plan. ' +
            'To record work without a pre-existing plan, use `agentteams plan quick` (quick log) instead.',
        );
      }
      if (!options.runnerType || !options.model) {
        throw new Error('--runner-type and --model are required for report create.');
      }

      const payload = parseReportOptions(options, { defaultStatus: 'COMPLETED' });
      if (!payload) {
        throw new Error('--file is required for report create.');
      }
      const repositoryRemoteUrl =
        toNonEmptyString(options.repositoryRemoteUrl) ?? (options.git === false ? undefined : getGitRemoteOriginUrl());

      const body: Record<string, unknown> = {
        planId: options.planId,
        ...(repositoryRemoteUrl ? { repositoryRemoteUrl } : {}),
        runnerType: options.runnerType,
        model: options.model,
        ...payload,
      };

      if (body.planId && body.durationSeconds === undefined) {
        process.stderr.write(
          '[info] durationSeconds is omitted; server will auto-calculate from linked plan timing when available.\n',
        );
      }

      return withSpinner(
        'Creating report...',
        async () => {
          const data = await createReport(apiUrl, options.projectId, headers, body);
          if (options.file) deleteIfTempFile(options.file, { keep: options.keepTemp });
          return data;
        },
        'Report created',
      );
    }
    case 'update': {
      if (!options.id) throw new Error('--id is required for report update');
      const body: Record<string, string | number> = {};

      if (options.title) body.title = options.title;
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        body.content = readFileSync(filePath, 'utf-8');
        printFileInfo(options.file, body.content);
      }
      if (options.status) body.status = options.status;

      const commitHash = toNonEmptyString(options.commitHash);
      const branchName = toNonEmptyString(options.branchName);
      const filesModified = toNonNegativeInteger(options.filesModified);
      const linesAdded = toNonNegativeInteger(options.linesAdded);
      const linesDeleted = toNonNegativeInteger(options.linesDeleted);
      const durationSeconds = toNonNegativeInteger(options.durationSeconds);
      const commitStart = toNonEmptyString(options.commitStart);
      const commitEnd = toNonEmptyString(options.commitEnd);
      const pullRequestId = toNonEmptyString(options.pullRequestId);
      const qualityScore = toNonNegativeInteger(options.qualityScore);

      if (commitHash !== undefined) body.commitHash = commitHash;
      if (branchName !== undefined) body.branchName = branchName;
      if (filesModified !== undefined) body.filesModified = filesModified;
      if (linesAdded !== undefined) body.linesAdded = linesAdded;
      if (linesDeleted !== undefined) body.linesDeleted = linesDeleted;
      if (durationSeconds !== undefined) body.durationSeconds = durationSeconds;
      if (commitStart !== undefined) body.commitStart = commitStart;
      if (commitEnd !== undefined) body.commitEnd = commitEnd;
      if (pullRequestId !== undefined) body.pullRequestId = pullRequestId;
      if (qualityScore !== undefined) body.qualityScore = qualityScore;

      return updateReport(apiUrl, options.projectId, headers, options.id, body);
    }
    case 'delete': {
      if (!options.id) throw new Error('--id is required for report delete');
      await deleteReport(apiUrl, options.projectId, headers, options.id);
      return { message: `Report ${options.id} deleted successfully` };
    }
    case 'download': {
      if (!options.id) throw new Error('--id is required for report download');
      const projectRoot = (() => {
        const configPath = findProjectConfig(process.cwd());
        if (!configPath) return null;
        return resolve(configPath, '..', '..');
      })();
      if (!projectRoot) {
        throw new Error("Project root not found. Run 'agentteams init' first.");
      }

      return withSpinner(
        'Downloading report...',
        async () => {
          const response = await getReport(apiUrl, options.projectId, headers, options.id);
          const report = response.data;

          const downloadDir = join(projectRoot, '.agentteams', 'cli', 'active-plan');
          if (!existsSync(downloadDir)) {
            mkdirSync(downloadDir, { recursive: true });
          }

          const existingFiles = readdirSync(downloadDir).filter((name) => name.endsWith('.md'));
          const idPrefix = report.id.slice(0, 8);
          const safeName = toSafeFileName(report.title) || 'report';
          const baseName = `${safeName}-${idPrefix}`;
          const used = new Set(existingFiles.map((name) => name.toLowerCase()));
          let fileName = `${baseName}.md`;
          let sequence = 2;
          while (used.has(fileName.toLowerCase())) {
            fileName = `${baseName}-${sequence}.md`;
            sequence += 1;
          }

          const filePath = join(downloadDir, fileName);
          const frontmatter = [
            '---',
            `reportId: ${report.id}`,
            `title: ${report.title}`,
            `status: ${report.status}`,
            report.planId ? `planId: ${report.planId}` : null,
            report.planTitle ? `planTitle: ${report.planTitle}` : null,
            report.webUrl ? `webUrl: ${report.webUrl}` : null,
            `downloadedAt: ${new Date().toISOString()}`,
            '---',
          ]
            .filter(Boolean)
            .join('\n');

          const content = report.content ?? '';
          writeFileSync(filePath, `${frontmatter}\n\n${content}`, 'utf-8');

          return {
            message: `Report downloaded to ${fileName}`,
            filePath: `.agentteams/cli/active-plan/${fileName}`,
          };
        },
        'Report downloaded',
      );
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
