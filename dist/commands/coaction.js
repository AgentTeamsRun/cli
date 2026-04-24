import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCoAction, createCoActionTakeaway, deleteCoAction, deleteCoActionTakeaway, getCoAction, listCoActionTakeaways, listCoActionHistories, listCoActions, updateCoAction, updateCoActionTakeaway, linkPlanToCoAction, unlinkPlanFromCoAction, linkCompletionReportToCoAction, unlinkCompletionReportFromCoAction, linkPostMortemToCoAction, unlinkPostMortemFromCoAction, } from '../api/coaction.js';
import { getMemberQuota } from '../api/member.js';
import { checkConventionFreshness } from './convention.js';
import { buildFreshnessNoticeLines } from './plan.js';
import { findProjectConfig } from '../utils/config.js';
import { deleteIfTempFile, toPositiveInteger, toSafeFileName } from '../utils/parsers.js';
import { printFileInfo, withSpinner } from '../utils/spinner.js';
import { isAxiosError } from 'axios';
function findProjectRoot() {
    const configPath = findProjectConfig(process.cwd());
    if (!configPath)
        return null;
    return resolve(configPath, '..', '..');
}
async function runFreshnessCheckSilent(apiUrl, projectId, headers) {
    const projectRoot = findProjectRoot();
    if (!projectRoot)
        return;
    try {
        const freshness = await checkConventionFreshness(apiUrl, projectId, headers, projectRoot);
        const hasChanges = freshness.platformGuidesChanged || freshness.conventionChanges.length > 0;
        if (!hasChanges)
            return;
        const noticeLines = buildFreshnessNoticeLines(freshness);
        for (const line of noticeLines) {
            process.stderr.write(`${line}\n`);
        }
        process.stderr.write('Run agentteams convention download to sync latest conventions.\n');
    }
    catch (error) {
        void error;
    }
}
function formatQuotaExceededMessage(coAction) {
    if (coAction.daily.used >= coAction.daily.limit) {
        return `Daily limit reached: ${coAction.daily.used}/${coAction.daily.limit} used. Resets tomorrow (UTC).`;
    }
    return `Monthly limit reached: ${coAction.monthly.used}/${coAction.monthly.limit} used. Resets next month (UTC).`;
}
export async function executeCoActionCommand(apiUrl, headers, action, options) {
    if (!options.projectId || typeof options.projectId !== 'string') {
        throw new Error('--project-id is required (or configure AGENTTEAMS_PROJECT_ID / .agentteams/config.json)');
    }
    switch (action) {
        case 'list': {
            await runFreshnessCheckSilent(apiUrl, options.projectId, headers);
            const params = {};
            if (options.status)
                params.status = options.status;
            if (options.search)
                params.search = options.search;
            const page = toPositiveInteger(options.page);
            const limitVal = toPositiveInteger(options.limit);
            const pageSizeVal = toPositiveInteger(options.pageSize);
            if (limitVal !== undefined && pageSizeVal !== undefined) {
                process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
            }
            const pageSize = limitVal ?? pageSizeVal;
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return withSpinner('Loading co-actions...', () => listCoActions(apiUrl, options.projectId, headers, params), 'Co-actions loaded');
        }
        case 'get': {
            if (!options.id)
                throw new Error('--id is required for coaction get');
            await runFreshnessCheckSilent(apiUrl, options.projectId, headers);
            return withSpinner('Loading co-action...', () => getCoAction(apiUrl, options.projectId, headers, options.id), 'Co-action loaded');
        }
        case 'takeaway-list': {
            if (!options.id)
                throw new Error('--id is required for coaction takeaway-list');
            const params = {};
            const page = toPositiveInteger(options.page);
            const limitVal = toPositiveInteger(options.limit);
            const pageSizeVal = toPositiveInteger(options.pageSize);
            if (limitVal !== undefined && pageSizeVal !== undefined) {
                process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
            }
            const pageSize = limitVal ?? pageSizeVal;
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return withSpinner('Loading co-action takeaways...', () => listCoActionTakeaways(apiUrl, options.projectId, headers, options.id, params), 'Co-action takeaways loaded');
        }
        case 'takeaway-create': {
            if (!options.id)
                throw new Error('--id is required for coaction takeaway-create');
            if (options.file) {
                const filePath = resolve(options.file);
                if (!existsSync(filePath)) {
                    throw new Error(`File not found: ${options.file}`);
                }
                options.content = readFileSync(filePath, 'utf-8');
                printFileInfo(options.file, options.content);
            }
            if (!options.content)
                throw new Error('--content or --file is required for coaction takeaway-create');
            const body = {
                content: options.content,
            };
            return withSpinner('Creating co-action takeaway...', async () => {
                const data = await createCoActionTakeaway(apiUrl, options.projectId, headers, options.id, body);
                if (options.file)
                    deleteIfTempFile(options.file);
                return data;
            }, 'Co-action takeaway created');
        }
        case 'takeaway-update': {
            if (!options.id)
                throw new Error('--id is required for coaction takeaway-update');
            if (!options.takeawayId)
                throw new Error('--takeaway-id is required for coaction takeaway-update');
            if (options.file) {
                const filePath = resolve(options.file);
                if (!existsSync(filePath)) {
                    throw new Error(`File not found: ${options.file}`);
                }
                options.content = readFileSync(filePath, 'utf-8');
                printFileInfo(options.file, options.content);
            }
            if (!options.content)
                throw new Error('--content or --file is required for coaction takeaway-update');
            const body = {
                content: options.content,
            };
            return withSpinner('Updating co-action takeaway...', async () => {
                const data = await updateCoActionTakeaway(apiUrl, options.projectId, headers, options.id, options.takeawayId, body);
                if (options.file)
                    deleteIfTempFile(options.file);
                return data;
            }, 'Co-action takeaway updated');
        }
        case 'takeaway-delete': {
            if (!options.id)
                throw new Error('--id is required for coaction takeaway-delete');
            if (!options.takeawayId)
                throw new Error('--takeaway-id is required for coaction takeaway-delete');
            return withSpinner('Deleting co-action takeaway...', async () => {
                await deleteCoActionTakeaway(apiUrl, options.projectId, headers, options.id, options.takeawayId);
                return { message: `CoAction takeaway ${options.takeawayId} deleted successfully` };
            }, 'Co-action takeaway deleted');
        }
        case 'history': {
            if (!options.id)
                throw new Error('--id is required for coaction history');
            const params = {};
            const page = toPositiveInteger(options.page);
            const limitVal = toPositiveInteger(options.limit);
            const pageSizeVal = toPositiveInteger(options.pageSize);
            if (limitVal !== undefined && pageSizeVal !== undefined) {
                process.stderr.write('[warn] --limit and --page-size both specified; --limit takes precedence.\n');
            }
            const pageSize = limitVal ?? pageSizeVal;
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return withSpinner('Loading co-action histories...', () => listCoActionHistories(apiUrl, options.projectId, headers, options.id, params), 'Co-action histories loaded');
        }
        case 'create': {
            if (!options.title)
                throw new Error('--title is required for coaction create');
            if (options.file) {
                const filePath = resolve(options.file);
                if (!existsSync(filePath)) {
                    throw new Error(`File not found: ${options.file}`);
                }
                options.content = readFileSync(filePath, 'utf-8');
                printFileInfo(options.file, options.content);
            }
            if (!options.content)
                throw new Error('--content or --file is required for coaction create');
            const body = {
                title: options.title,
                content: options.content,
                status: options.status,
                visibility: options.visibility,
            };
            try {
                return await withSpinner('Creating co-action...', async () => {
                    const data = await createCoAction(apiUrl, options.projectId, headers, body);
                    if (options.file)
                        deleteIfTempFile(options.file);
                    const id = data?.data?.id ?? options.id;
                    if (id)
                        process.stderr.write(`Tip: Add a takeaway to capture key insights or knowledge for the next reader — agentteams coaction takeaway-create --id ${id}\n`);
                    return data;
                }, 'Co-action created');
            }
            catch (error) {
                if (options.file)
                    deleteIfTempFile(options.file);
                if (isAxiosError(error) &&
                    error.response?.status === 403 &&
                    error.response.data &&
                    typeof error.response.data === 'object' &&
                    error.response.data.errorCode === 'QUOTA_EXCEEDED') {
                    const quota = await getMemberQuota(apiUrl, headers);
                    if (quota.coAction) {
                        return formatQuotaExceededMessage(quota.coAction);
                    }
                }
                throw error;
            }
        }
        case 'update': {
            if (!options.id)
                throw new Error('--id is required for coaction update');
            const body = {};
            if (options.title)
                body.title = options.title;
            if (options.content)
                body.content = options.content;
            if (options.file) {
                const filePath = resolve(options.file);
                if (!existsSync(filePath)) {
                    throw new Error(`File not found: ${options.file}`);
                }
                body.content = readFileSync(filePath, 'utf-8');
                printFileInfo(options.file, body.content);
            }
            if (options.status)
                body.status = options.status;
            if (options.visibility)
                body.visibility = options.visibility;
            if (Object.prototype.hasOwnProperty.call(options, 'planId')) {
                body.planId = options.planId === null || options.planId === 'null' ? null : options.planId;
            }
            const updateResult = await updateCoAction(apiUrl, options.projectId, headers, options.id, body);
            if (options.file)
                deleteIfTempFile(options.file);
            if (options.id)
                process.stderr.write(`Tip: Add a takeaway to capture key insights or knowledge for the next reader — agentteams coaction takeaway-create --id ${options.id}\n`);
            return updateResult;
        }
        case 'delete': {
            if (!options.id)
                throw new Error('--id is required for coaction delete');
            await deleteCoAction(apiUrl, options.projectId, headers, options.id);
            return { message: `CoAction ${options.id} deleted successfully` };
        }
        case 'download': {
            if (!options.id)
                throw new Error('--id is required for coaction download');
            const projectRoot = findProjectRoot();
            if (!projectRoot) {
                throw new Error("Project root not found. Run 'agentteams init' first.");
            }
            return withSpinner('Downloading co-action...', async () => {
                const response = await getCoAction(apiUrl, options.projectId, headers, options.id);
                const coAction = response.data;
                const downloadDir = join(projectRoot, '.agentteams', 'cli', 'active-coaction');
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
                const linkedPlans = (coAction.linkedPlans ?? []);
                const linkedCRs = (coAction.linkedCompletionReports ?? []);
                const linkedPMs = (coAction.linkedPostMortems ?? []);
                const takeaways = (coAction.linkedTakeaways ?? []);
                const frontmatterLines = [
                    '---',
                    `coActionId: ${coAction.id}`,
                    `title: ${coAction.title}`,
                    `status: ${coAction.status}`,
                    `visibility: ${coAction.visibility}`,
                    `createdBy: ${coAction.createdByName ?? '-'}`,
                    `takeaways: ${takeaways.length}`,
                    coAction.webUrl ? `webUrl: ${coAction.webUrl}` : null,
                ].filter((line) => line !== null);
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
                    filePath: `.agentteams/cli/active-coaction/${fileName}`,
                };
            }, 'Co-action downloaded');
        }
        case 'cleanup': {
            const projectRoot = findProjectRoot();
            if (!projectRoot) {
                throw new Error("Project root not found. Run 'agentteams init' first.");
            }
            const activeCoActionDir = join(projectRoot, '.agentteams', 'cli', 'active-coaction');
            if (!existsSync(activeCoActionDir)) {
                return { message: 'No active-coaction directory found.', deletedFiles: [] };
            }
            const deletedFiles = await withSpinner('Cleaning up co-action files...', async () => {
                const allFiles = readdirSync(activeCoActionDir).filter((f) => f.endsWith('.md'));
                const deleted = [];
                if (options.id) {
                    for (const file of allFiles) {
                        const content = readFileSync(join(activeCoActionDir, file), 'utf-8');
                        const match = content.match(/^coActionId:\s*(.+)$/m);
                        if (match && match[1].trim() === options.id) {
                            rmSync(join(activeCoActionDir, file));
                            deleted.push(file);
                        }
                    }
                }
                else {
                    for (const file of allFiles) {
                        rmSync(join(activeCoActionDir, file));
                        deleted.push(file);
                    }
                }
                return deleted;
            }, 'Cleaned up co-action files');
            return {
                message: deletedFiles.length > 0
                    ? `Deleted ${deletedFiles.length} file(s).`
                    : 'No matching files found.',
                deletedFiles,
            };
        }
        case 'link-plan': {
            if (!options.id)
                throw new Error('--id is required for coaction link-plan');
            if (!options.planId)
                throw new Error('--plan-id is required for coaction link-plan');
            return withSpinner('Linking plan...', () => linkPlanToCoAction(apiUrl, options.projectId, headers, options.id, options.planId), 'Plan linked');
        }
        case 'unlink-plan': {
            if (!options.id)
                throw new Error('--id is required for coaction unlink-plan');
            if (!options.planId)
                throw new Error('--plan-id is required for coaction unlink-plan');
            return withSpinner('Unlinking plan...', () => unlinkPlanFromCoAction(apiUrl, options.projectId, headers, options.id, options.planId), 'Plan unlinked');
        }
        case 'link-completion-report': {
            if (!options.id)
                throw new Error('--id is required for coaction link-completion-report');
            if (!options.completionReportId)
                throw new Error('--completion-report-id is required for coaction link-completion-report');
            return withSpinner('Linking completion report...', () => linkCompletionReportToCoAction(apiUrl, options.projectId, headers, options.id, options.completionReportId), 'Completion report linked');
        }
        case 'unlink-completion-report': {
            if (!options.id)
                throw new Error('--id is required for coaction unlink-completion-report');
            if (!options.completionReportId)
                throw new Error('--completion-report-id is required for coaction unlink-completion-report');
            return withSpinner('Unlinking completion report...', () => unlinkCompletionReportFromCoAction(apiUrl, options.projectId, headers, options.id, options.completionReportId), 'Completion report unlinked');
        }
        case 'link-post-mortem': {
            if (!options.id)
                throw new Error('--id is required for coaction link-post-mortem');
            if (!options.postMortemId)
                throw new Error('--post-mortem-id is required for coaction link-post-mortem');
            return withSpinner('Linking post-mortem...', () => linkPostMortemToCoAction(apiUrl, options.projectId, headers, options.id, options.postMortemId), 'Post-mortem linked');
        }
        case 'unlink-post-mortem': {
            if (!options.id)
                throw new Error('--id is required for coaction unlink-post-mortem');
            if (!options.postMortemId)
                throw new Error('--post-mortem-id is required for coaction unlink-post-mortem');
            return withSpinner('Unlinking post-mortem...', () => unlinkPostMortemFromCoAction(apiUrl, options.projectId, headers, options.id, options.postMortemId), 'Post-mortem unlinked');
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=coaction.js.map