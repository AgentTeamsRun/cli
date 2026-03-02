import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createCoAction,
  createCoActionTakeaway,
  deleteCoAction,
  deleteCoActionTakeaway,
  getCoAction,
  listCoActionTakeaways,
  listCoActionHistories,
  listCoActions,
  updateCoAction,
  updateCoActionTakeaway,
  linkPlanToCoAction,
  unlinkPlanFromCoAction,
  linkCompletionReportToCoAction,
  unlinkCompletionReportFromCoAction,
  linkPostMortemToCoAction,
  unlinkPostMortemFromCoAction,
} from '../api/coaction.js';
import { findProjectConfig } from '../utils/config.js';
import { deleteIfTempFile, toPositiveInteger, toSafeFileName } from '../utils/parsers.js';
import { printFileInfo, withSpinner } from '../utils/spinner.js';

export async function executeCoActionCommand(
  apiUrl: string,
  headers: any,
  action: string,
  options: any
): Promise<any> {
  if (!options.projectId || typeof options.projectId !== 'string') {
    throw new Error('--project-id is required (or configure AGENTTEAMS_PROJECT_ID / .agentteams/config.json)');
  }

  switch (action) {
    case 'list': {
      const params: Record<string, string | number> = {};
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

      return listCoActions(apiUrl, options.projectId, headers, params);
    }
    case 'get': {
      if (!options.id) throw new Error('--id is required for coaction get');
      return getCoAction(apiUrl, options.projectId, headers, options.id);
    }
    case 'takeaway-list': {
      if (!options.id) throw new Error('--id is required for coaction takeaway-list');

      const params: Record<string, string | number> = {};
      const page = toPositiveInteger(options.page);
      const limitVal = toPositiveInteger(options.limit);
      const pageSizeVal = toPositiveInteger(options.pageSize);
      if (limitVal !== undefined && pageSizeVal !== undefined) {
        process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
      }
      const pageSize = limitVal ?? pageSizeVal;
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      return withSpinner(
        'Loading co-action takeaways...',
        () => listCoActionTakeaways(apiUrl, options.projectId, headers, options.id, params),
        'Co-action takeaways loaded',
      );
    }
    case 'takeaway-create': {
      if (!options.id) throw new Error('--id is required for coaction takeaway-create');
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        options.content = readFileSync(filePath, 'utf-8');
        printFileInfo(options.file, options.content);
      }
      if (!options.content) throw new Error('--content or --file is required for coaction takeaway-create');

      const body: Record<string, unknown> = {
        content: options.content,
      };

      return withSpinner(
        'Creating co-action takeaway...',
        async () => {
          const data = await createCoActionTakeaway(apiUrl, options.projectId, headers, options.id, body);
          if (options.file) deleteIfTempFile(options.file);
          return data;
        },
        'Co-action takeaway created',
      );
    }
    case 'takeaway-update': {
      if (!options.id) throw new Error('--id is required for coaction takeaway-update');
      if (!options.takeawayId) throw new Error('--takeaway-id is required for coaction takeaway-update');
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        options.content = readFileSync(filePath, 'utf-8');
        printFileInfo(options.file, options.content);
      }
      if (!options.content) throw new Error('--content or --file is required for coaction takeaway-update');

      const body: Record<string, unknown> = {
        content: options.content,
      };

      return withSpinner(
        'Updating co-action takeaway...',
        async () => {
          const data = await updateCoActionTakeaway(apiUrl, options.projectId, headers, options.id, options.takeawayId, body);
          if (options.file) deleteIfTempFile(options.file);
          return data;
        },
        'Co-action takeaway updated',
      );
    }
    case 'takeaway-delete': {
      if (!options.id) throw new Error('--id is required for coaction takeaway-delete');
      if (!options.takeawayId) throw new Error('--takeaway-id is required for coaction takeaway-delete');

      return withSpinner(
        'Deleting co-action takeaway...',
        async () => {
          await deleteCoActionTakeaway(apiUrl, options.projectId, headers, options.id, options.takeawayId);
          return { message: `CoAction takeaway ${options.takeawayId} deleted successfully` };
        },
        'Co-action takeaway deleted',
      );
    }

    case 'history': {
      if (!options.id) throw new Error('--id is required for coaction history');

      const params: Record<string, string | number> = {};
      const page = toPositiveInteger(options.page);
      const limitVal = toPositiveInteger(options.limit);
      const pageSizeVal = toPositiveInteger(options.pageSize);
      if (limitVal !== undefined && pageSizeVal !== undefined) {
        process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
      }
      const pageSize = limitVal ?? pageSizeVal;
      if (page !== undefined) params.page = page;
      if (pageSize !== undefined) params.pageSize = pageSize;

      return withSpinner(
        'Loading co-action histories...',
        () => listCoActionHistories(apiUrl, options.projectId, headers, options.id, params),
        'Co-action histories loaded',
      );
    }
    case 'create': {
      if (!options.title) throw new Error('--title is required for coaction create');
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        options.content = readFileSync(filePath, 'utf-8');
        printFileInfo(options.file, options.content);
      }
      if (!options.content) throw new Error('--content or --file is required for coaction create');

      const body: Record<string, unknown> = {
        title: options.title,
        content: options.content,
        status: options.status,
        visibility: options.visibility,
      };

      return withSpinner(
        'Creating co-action...',
        async () => {
          const data = await createCoAction(apiUrl, options.projectId, headers, body);
          if (options.file) deleteIfTempFile(options.file);
          const id = (data as any)?.data?.id ?? options.id;
          if (id) process.stdout.write(`Tip: Add a takeaway — agentteams coaction takeaway-create --id ${id}\n`);
          return data;
        },
        'Co-action created',
      );
    }
    case 'update': {
      if (!options.id) throw new Error('--id is required for coaction update');
      const body: Record<string, string | null | undefined> = {};

      if (options.title) body.title = options.title;
      if (options.content) body.content = options.content;
      if (options.file) {
        const filePath = resolve(options.file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${options.file}`);
        }
        body.content = readFileSync(filePath, 'utf-8');
        printFileInfo(options.file, body.content);
      }
      if (options.status) body.status = options.status;
      if (options.visibility) body.visibility = options.visibility;
      if (Object.prototype.hasOwnProperty.call(options, 'planId')) {
        body.planId = options.planId === null || options.planId === 'null' ? null : options.planId;
      }

      const updateResult = await updateCoAction(apiUrl, options.projectId, headers, options.id, body);
      if (options.file) deleteIfTempFile(options.file);
      if (options.id) process.stdout.write(`Tip: Add a takeaway — agentteams coaction takeaway-create --id ${options.id}\n`);
      return updateResult;
    }
    case 'delete': {
      if (!options.id) throw new Error('--id is required for coaction delete');
      await deleteCoAction(apiUrl, options.projectId, headers, options.id);
      return { message: `CoAction ${options.id} deleted successfully` };
    }
    case 'download': {
      if (!options.id) throw new Error('--id is required for coaction download');
      const projectRoot = (() => {
        const configPath = findProjectConfig(process.cwd());
        if (!configPath) return null;
        return resolve(configPath, '..', '..');
      })();
      if (!projectRoot) {
        throw new Error("Project root not found. Run 'agentteams init' first.");
      }

      return withSpinner(
        'Downloading co-action...',
        async () => {
          const response = await getCoAction(apiUrl, options.projectId, headers, options.id);
          const coAction = response.data;

          const downloadDir = join(projectRoot, '.agentteams', 'active-coaction');
          if (!existsSync(downloadDir)) {
            mkdirSync(downloadDir, { recursive: true });
          }

          const existingFiles = readdirSync(downloadDir).filter((name) => name.endsWith('.md'));
          const idPrefix = coAction.id.slice(0, 8);
          const safeName = toSafeFileName(coAction.title) || 'coaction';
          const baseName = `${safeName}-${idPrefix}`;
          const used = new Set(existingFiles.map((name) => name.toLowerCase()));
          let fileName = `${baseName}.md`;
          let sequence = 2;
          while (used.has(fileName.toLowerCase())) {
            fileName = `${baseName}-${sequence}.md`;
            sequence += 1;
          }

          const filePath = join(downloadDir, fileName);
          const linkedPlans = (coAction.linkedPlans ?? []) as Array<{ id: string; title: string }>;
          const linkedCRs = (coAction.linkedCompletionReports ?? []) as Array<{ id: string; title: string }>;
          const linkedPMs = (coAction.linkedPostMortems ?? []) as Array<{ id: string; title: string }>;
          const takeaways = (coAction.linkedTakeaways ?? []) as Array<{ id: string; content: string; createdByName?: string; createdAt: string }>;

          const frontmatterLines = [
            '---',
            `coActionId: ${coAction.id}`,
            `title: ${coAction.title}`,
            `status: ${coAction.status}`,
            `visibility: ${coAction.visibility}`,
            `createdBy: ${coAction.createdByName ?? '-'}`,
            `takeaways: ${takeaways.length}`,
          ];
          if (linkedPlans.length > 0) {
            frontmatterLines.push('linkedPlans:');
            for (const p of linkedPlans) {
              frontmatterLines.push(`  - id: ${p.id}`);
              frontmatterLines.push(`    title: ${p.title}`);
            }
          }
          if (linkedCRs.length > 0) {
            frontmatterLines.push('linkedCompletionReports:');
            for (const cr of linkedCRs) {
              frontmatterLines.push(`  - id: ${cr.id}`);
              frontmatterLines.push(`    title: ${cr.title}`);
            }
          }
          if (linkedPMs.length > 0) {
            frontmatterLines.push('linkedPostMortems:');
            for (const pm of linkedPMs) {
              frontmatterLines.push(`  - id: ${pm.id}`);
              frontmatterLines.push(`    title: ${pm.title}`);
            }
          }
          frontmatterLines.push(`downloadedAt: ${new Date().toISOString()}`);
          frontmatterLines.push('---');
          const frontmatter = frontmatterLines.join('\n');

          const takeawaysSection = takeaways.length > 0
            ? '\n## Takeaways\n\n' + takeaways.map((t, i) => `${i + 1}. ${t.content} _(${t.createdByName ?? '-'}, ${t.createdAt})_`).join('\n') + '\n'
            : '';

          const content = coAction.content ?? '';
          writeFileSync(filePath, `${frontmatter}\n${takeawaysSection}\n${content}`, 'utf-8');

          return {
            message: `Co-action downloaded to ${fileName}`,
            filePath: `.agentteams/active-coaction/${fileName}`,
          };
        },
        'Co-action downloaded',
      );
    }
    case 'link-plan': {
      if (!options.id) throw new Error('--id is required for coaction link-plan');
      if (!options.planId) throw new Error('--plan-id is required for coaction link-plan');

      return withSpinner(
        'Linking plan...',
        () => linkPlanToCoAction(apiUrl, options.projectId, headers, options.id, options.planId),
        'Plan linked',
      );
    }
    case 'unlink-plan': {
      if (!options.id) throw new Error('--id is required for coaction unlink-plan');
      if (!options.planId) throw new Error('--plan-id is required for coaction unlink-plan');

      return withSpinner(
        'Unlinking plan...',
        () => unlinkPlanFromCoAction(apiUrl, options.projectId, headers, options.id, options.planId),
        'Plan unlinked',
      );
    }
    case 'link-completion-report': {
      if (!options.id) throw new Error('--id is required for coaction link-completion-report');
      if (!options.completionReportId) throw new Error('--completion-report-id is required for coaction link-completion-report');

      return withSpinner(
        'Linking completion report...',
        () => linkCompletionReportToCoAction(apiUrl, options.projectId, headers, options.id, options.completionReportId),
        'Completion report linked',
      );
    }
    case 'unlink-completion-report': {
      if (!options.id) throw new Error('--id is required for coaction unlink-completion-report');
      if (!options.completionReportId) throw new Error('--completion-report-id is required for coaction unlink-completion-report');

      return withSpinner(
        'Unlinking completion report...',
        () => unlinkCompletionReportFromCoAction(apiUrl, options.projectId, headers, options.id, options.completionReportId),
        'Completion report unlinked',
      );
    }
    case 'link-post-mortem': {
      if (!options.id) throw new Error('--id is required for coaction link-post-mortem');
      if (!options.postMortemId) throw new Error('--post-mortem-id is required for coaction link-post-mortem');

      return withSpinner(
        'Linking post-mortem...',
        () => linkPostMortemToCoAction(apiUrl, options.projectId, headers, options.id, options.postMortemId),
        'Post-mortem linked',
      );
    }
    case 'unlink-post-mortem': {
      if (!options.id) throw new Error('--id is required for coaction unlink-post-mortem');
      if (!options.postMortemId) throw new Error('--post-mortem-id is required for coaction unlink-post-mortem');

      return withSpinner(
        'Unlinking post-mortem...',
        () => unlinkPostMortemFromCoAction(apiUrl, options.projectId, headers, options.id, options.postMortemId),
        'Post-mortem unlinked',
      );
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
