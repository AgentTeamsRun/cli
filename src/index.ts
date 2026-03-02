#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { executeCommand } from './commands/index.js';
import { formatOutput } from './utils/formatter.js';
import { handleError } from './utils/errors.js';
import { createSummaryLines, shouldPrintSummary, type OutputFormat } from './utils/outputPolicy.js';
import { printInitResult } from './utils/initOutput.js';
import { startUpdateCheck } from './utils/updateCheck.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

function normalizeFormat(format: unknown, fallback: OutputFormat): OutputFormat {
  if (format === 'json' || format === 'text') return format;
  return fallback;
}

function writeOutputFile(outputFile: string, content: string): { resolvedPath: string; bytes: number } {
  const resolvedPath = resolve(outputFile);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  return { resolvedPath, bytes };
}

function printCommandResult(params: {
  result: unknown;
  format: OutputFormat;
  outputFile?: string;
  verbose?: boolean;
  resource?: string;
  action?: string;
  formatExplicit?: boolean;
}): void {
  const outputText =
    typeof params.result === 'string' ? params.result : formatOutput(params.result, params.format);

  const summaryLines = createSummaryLines(params.result, {
    resource: params.resource,
    action: params.action,
  });

  if (typeof params.outputFile === 'string' && params.outputFile.trim().length > 0) {
    const { resolvedPath, bytes } = writeOutputFile(params.outputFile, outputText);
    console.log(`Saved output to ${resolvedPath} (${bytes} bytes).`);
    for (const line of summaryLines) {
      console.log(line);
    }

    if (params.verbose) {
      console.log(outputText);
    }
    return;
  }

  if (shouldPrintSummary({
    resource: params.resource,
    action: params.action,
    format: params.format,
    formatExplicit: params.formatExplicit,
    outputFile: params.outputFile,
    verbose: params.verbose,
  })) {
    for (const line of summaryLines) {
      console.log(line);
    }
    return;
  }

  console.log(outputText);
}

const CONVENTION_HINT = `\nFor workflow rules and reporting guidelines, see: .agentteams/convention.md`;

program
  .name('agentteams')
  .description('CLI tool for AgentTeams API')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize AgentTeams CLI via OAuth')
  .option('--format <format>', 'Output format (json, text)', 'text')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (options) => {
    try {
      const result = await executeCommand('init', 'start', {});
      const format = normalizeFormat(options.format, 'text');

      printInitResult(result, format);
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync local convention files from API')
  .option('--format <format>', 'Output format (json, text)', 'text')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (options) => {
    try {
      const result = await executeCommand('sync', 'download', {
        cwd: process.cwd(),
      });

      printCommandResult({
        result,
        format: normalizeFormat(options.format, 'text'),
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Manage plans')
  .argument('<action>', 'Action to perform (list, get, show, create, update, delete, assign, download, cleanup, start, finish, quick, status, set-status)')
  .option('--id <id>', 'Plan ID')
  .option('--title <title>', 'Plan title')
  .option('--search <text>', 'Plan title/ID search keyword (list only)')
  .option('--content <content>', 'Plan content (plain text or Tiptap JSON)')
  .option('--interpret-escapes', 'Interpret \\n sequences in --content as newlines (create/update only)', false)
  .option('--file <path>', 'Read plan content from a local file (create/update)')
  .option('--template <name>', 'Plan content template (refactor-minimal, quick-minimal, create only)')
  .option('--status <status>', 'Plan status (DRAFT, PENDING, ASSIGNED, IN_PROGRESS, BLOCKED, DONE, CANCELLED)')
  .option('--type <type>', 'Plan type (FEATURE, BUG_FIX, ISSUE, REFACTOR, CHORE)')
  .option('--priority <priority>', 'Plan priority (LOW, MEDIUM, HIGH)')
  .option('--assigned-to <id>', 'Assigned agent config ID (list filter)')
  .option('--task <text>', 'Task summary for plan start/finish')
  .option('--report-title <title>', 'Completion report title (plan finish)')
  .option('--report-file <path>', 'Read completion report content from a local file (plan finish)')
  .option('--report-status <status>', 'Completion report status: COMPLETED, FAILED, PARTIAL (plan finish)')
  .option('--quality-score <n>', 'Quality score 0-100 (plan finish)')
  .option('--commit-hash <hash>', 'Git commit hash (plan finish, manual override)')
  .option('--branch-name <name>', 'Git branch name (plan finish, manual override)')
  .option('--files-modified <n>', 'Number of modified files (plan finish, manual override)')
  .option('--lines-added <n>', 'Number of added lines (plan finish, manual override)')
  .option('--lines-deleted <n>', 'Number of deleted lines (plan finish, manual override)')
  .option('--duration-seconds <n>', 'Duration in seconds (plan finish, manual only)')
  .option('--commit-start <hash>', 'Commit range start hash (plan finish, manual only)')
  .option('--commit-end <hash>', 'Commit range end hash (plan finish, manual only)')
  .option('--pull-request-id <id>', 'Pull request ID (plan finish, manual only)')
  .option('--no-git', 'Disable git metrics auto-collection (plan finish)')
  .option('--page <number>', 'Page number (list only)')
  .option('--page-size <number>', 'Page size (list only)')
  .option('--agent <agent>', 'Agent name or ID to assign')
  .option('--include-deps', 'Include dependencies in plan get/show output', false)
  .option('--format <format>', 'Output format (json, text)')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const normalizedFormat = normalizeFormat(options.format, 'json');
      const result = await executeCommand('plan', action, {
        id: options.id,
        title: options.title,
        search: options.search,
        content: options.content,
        interpretEscapes: options.interpretEscapes,
        file: options.file,
        template: options.template,
        status: options.status,
        type: options.type,
        priority: options.priority,
        assignedTo: options.assignedTo,
        task: options.task,
        reportTitle: options.reportTitle,
        reportFile: options.reportFile,
        reportStatus: options.reportStatus,
        qualityScore: options.qualityScore,
        commitHash: options.commitHash,
        branchName: options.branchName,
        filesModified: options.filesModified,
        linesAdded: options.linesAdded,
        linesDeleted: options.linesDeleted,
        durationSeconds: options.durationSeconds,
        commitStart: options.commitStart,
        commitEnd: options.commitEnd,
        pullRequestId: options.pullRequestId,
        git: options.git,
        page: options.page,
        pageSize: options.pageSize,
        agent: options.agent,
        includeDeps: options.includeDeps,
        format: normalizedFormat,
        formatExplicit: typeof options.format === 'string',
      });

      printCommandResult({
        result,
        format: normalizedFormat,
        outputFile: options.outputFile,
        verbose: options.verbose,
        resource: 'plan',
        action,
        formatExplicit: typeof options.format === 'string',
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('comment')
  .description('Manage plan comments')
  .argument('<action>', 'Action to perform (list, get, create, update, delete)')
  .option('--id <id>', 'Comment ID')
  .option('--plan-id <id>', 'Plan ID')
  .option('--type <type>', 'Comment type (RISK, MODIFICATION, GENERAL)')
  .option('--content <content>', 'Comment content')
  .option('--affected-files <files>', 'Comma-separated list of affected file paths (create/update)')
  .option('--page <number>', 'Page number (list only)')
  .option('--page-size <number>', 'Page size (list only)')
  .option('--format <format>', 'Output format (json, text)', 'json')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const result = await executeCommand('comment', action, {
        id: options.id,
        planId: options.planId,
        type: options.type,
        content: options.content,
        affectedFiles: options.affectedFiles,
        page: options.page,
        pageSize: options.pageSize,
      });

      printCommandResult({
        result,
        format: normalizeFormat(options.format, 'json'),
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Manage completion reports')
  .argument('<action>', 'Action to perform (list, get, create, update, delete)')
  .option('--id <id>', 'Report ID')
  .option('--plan-id <id>', 'Plan ID (optional)')
  .option('--title <title>', 'Report title')
  .option('--file <path>', 'Read report content from a local file (create/update)')
  .option('--status <status>', 'Report status (COMPLETED, FAILED, PARTIAL)')
  .option('--commit-hash <hash>', 'Git commit hash (manual override)')
  .option('--branch-name <name>', 'Git branch name (manual override)')
  .option('--files-modified <n>', 'Number of modified files (manual override)')
  .option('--lines-added <n>', 'Number of added lines (manual override)')
  .option('--lines-deleted <n>', 'Number of deleted lines (manual override)')
  .option('--duration-seconds <n>', 'Duration in seconds (manual only)')
  .option('--commit-start <hash>', 'Commit range start hash (manual only)')
  .option('--commit-end <hash>', 'Commit range end hash (manual only)')
  .option('--pull-request-id <id>', 'Pull request ID (manual only)')
  .option('--quality-score <n>', 'Quality score 0-100')
  .option('--no-git', 'Disable git metrics auto-collection')
  .option('--page <number>', 'Page number (list only)')
  .option('--page-size <number>', 'Page size (list only)')
  .option('--search <text>', 'Title keyword search (list only)')
  .option('--limit <n>', 'Max results per page, alias for --page-size (list only)')
  .option('--api-url <url>', 'Override API URL (optional)')
  .option('--api-key <key>', 'Override API key (optional)')
  .option('--project-id <id>', 'Override project ID (optional)')
  .option('--team-id <id>', 'Override team ID (optional)')
  .option('--agent-name <name>', 'Override agent name (optional)')
  .option('--format <format>', 'Output format (json, text)')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {

      const normalizedFormat = normalizeFormat(options.format, 'json');
      const result = await executeCommand('report', action, {
        id: options.id,
        planId: options.planId,
        title: options.title,
        file: options.file,
        status: options.status,
        commitHash: options.commitHash,
        branchName: options.branchName,
        filesModified: options.filesModified,
        linesAdded: options.linesAdded,
        linesDeleted: options.linesDeleted,
        durationSeconds: options.durationSeconds,
        commitStart: options.commitStart,
        commitEnd: options.commitEnd,
        pullRequestId: options.pullRequestId,
        qualityScore: options.qualityScore,
        git: options.git,
        page: options.page,
        pageSize: options.pageSize,
        search: options.search,
        limit: options.limit,
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        projectId: options.projectId,
        teamId: options.teamId,
        agentName: options.agentName,
      });

      printCommandResult({
        result,
        format: normalizedFormat,
        outputFile: options.outputFile,
        verbose: options.verbose,
        resource: 'report',
        action,
        formatExplicit: typeof options.format === 'string',
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('postmortem')
  .description('Manage post mortems')
  .argument('<action>', 'Action to perform (list, get, create, update, delete)')
  .option('--id <id>', 'Post mortem ID')
  .option('--plan-id <id>', 'Plan ID (optional)')
  .option('--title <title>', 'Post mortem title')
  .option('--content <content>', 'Post mortem markdown content (short text; use --file for long content)')
  .option('--file <path>', 'Read postmortem content from a local file (create/update)')
  .option('--action-items <csv>', 'Action items (comma-separated)')
  .option('--status <status>', 'Post mortem status (OPEN, IN_PROGRESS, RESOLVED)')
  .option('--page <number>', 'Page number (list only)')
  .option('--page-size <number>', 'Page size (list only)')
  .option('--search <text>', 'Title keyword search (list only)')
  .option('--limit <n>', 'Max results per page, alias for --page-size (list only)')
  .option('--api-url <url>', 'Override API URL (optional)')
  .option('--api-key <key>', 'Override API key (optional)')
  .option('--project-id <id>', 'Override project ID (optional)')
  .option('--team-id <id>', 'Override team ID (optional)')
  .option('--agent-name <name>', 'Override agent name (optional)')
  .option('--format <format>', 'Output format (json, text)')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const normalizedFormat = normalizeFormat(options.format, 'json');
      const result = await executeCommand('postmortem', action, {
        id: options.id,
        planId: options.planId,
        title: options.title,
        content: options.content,
        file: options.file,
        actionItems: options.actionItems,
        status: options.status,
        page: options.page,
        pageSize: options.pageSize,
        search: options.search,
        limit: options.limit,
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        projectId: options.projectId,
        teamId: options.teamId,
        agentName: options.agentName,
      });

      printCommandResult({
        result,
        format: normalizedFormat,
        outputFile: options.outputFile,
        verbose: options.verbose,
        resource: 'postmortem',
        action,
        formatExplicit: typeof options.format === 'string',
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('coaction')
  .description('Manage co-actions (session context dumps)')
  .argument('<action>', 'Action to perform (list, get, create, update, delete, download, takeaway-list, takeaway-create, takeaway-update, takeaway-delete, history, link-plan, unlink-plan, link-completion-report, unlink-completion-report, link-post-mortem, unlink-post-mortem)')
  .option('--id <id>', 'Co-action ID')
  .option('--takeaway-id <id>', 'Co-action takeaway ID (for takeaway-update/takeaway-delete)')
  .option('--plan-id <id>', 'Plan ID (for link-plan/unlink-plan)')
  .option('--completion-report-id <id>', 'Completion report ID for linking/unlinking')
  .option('--post-mortem-id <id>', 'Post-mortem ID for linking/unlinking')
  .option('--title <title>', 'Co-action title')
  .option('--content <content>', 'Co-action content (short text; use --file for long content)')
  .option('--file <path>', 'Read co-action content from a local file (create/update)')
  .option('--status <status>', 'Co-action status (OPEN, CLOSED)')
  .option('--visibility <visibility>', 'Co-action visibility (PRIVATE, PROJECT)')
  .option('--page <number>', 'Page number (list only)')
  .option('--page-size <number>', 'Page size (list only)')
  .option('--search <text>', 'Title keyword search (list only)')
  .option('--limit <n>', 'Max results per page, alias for --page-size (list only)')
  .option('--api-url <url>', 'Override API URL (optional)')
  .option('--api-key <key>', 'Override API key (optional)')
  .option('--project-id <id>', 'Override project ID (optional)')
  .option('--team-id <id>', 'Override team ID (optional)')
  .option('--agent-name <name>', 'Override agent name (optional)')
  .option('--format <format>', 'Output format (json, text)')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const normalizedFormat = normalizeFormat(options.format, 'json');
      const result = await executeCommand('coaction', action, {
        id: options.id,
        takeawayId: options.takeawayId,
        planId: options.planId,
        completionReportId: options.completionReportId,
        postMortemId: options.postMortemId,
        title: options.title,
        content: options.content,
        file: options.file,
        status: options.status,
        visibility: options.visibility,
        page: options.page,
        pageSize: options.pageSize,
        search: options.search,
        limit: options.limit,
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        projectId: options.projectId,
        teamId: options.teamId,
        agentName: options.agentName,
      });

      printCommandResult({
        result,
        format: normalizedFormat,
        outputFile: options.outputFile,
        verbose: options.verbose,
        resource: 'coaction',
        action,
        formatExplicit: typeof options.format === 'string',
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('feedback')
  .description('Manage platform feedback')
  .argument('<action>', 'Action to perform (create)')
  .option('--category <category>', 'Feedback category (BUG, SUGGESTION, CONVENTION, UX)')
  .option('--title <title>', 'Feedback title')
  .option('--content <content>', 'Feedback content')
  .option('--api-url <url>', 'Override API URL (optional)')
  .option('--api-key <key>', 'Override API key (optional)')
  .option('--project-id <id>', 'Override project ID (optional)')
  .option('--team-id <id>', 'Override team ID (optional)')
  .option('--agent-name <name>', 'Override agent name (optional)')
  .option('--format <format>', 'Output format (json, text)', 'text')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const normalizedFormat = normalizeFormat(options.format, 'text');
      const result = await executeCommand('feedback', action, {
        category: options.category,
        title: options.title,
        content: options.content,
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        projectId: options.projectId,
        teamId: options.teamId,
        agentName: options.agentName,
      });

      printCommandResult({
        result,
        format: normalizedFormat,
        outputFile: options.outputFile,
        verbose: options.verbose,
        resource: 'feedback',
        action,
        formatExplicit: typeof options.format === 'string',
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('convention')
  .description('Manage project conventions')
  .argument('<action>', 'Action to perform (list, show, download, create, update, delete)')
  .option('--cwd <path>', 'Working directory (defaults to current)')
  .option(
    '-f, --file <path>',
    'Target convention markdown file (repeatable; create requires a file under .agentteams/<category>/)',
    (value, previous: string[] = []) => previous.concat([value]),
    [] as string[]
  )
  .option('--apply', 'Apply changes to server (default: dry-run)', false)
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const result = await executeCommand('convention', action, {
        cwd: options.cwd ?? process.cwd(),
        file: options.file,
        apply: options.apply,
      });

      printCommandResult({
        result,
        format: 'text',
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('dependency')
  .description('Manage plan dependencies')
  .argument('<action>', 'Action to perform (list, create, delete)')
  .option('--plan-id <id>', 'Plan ID')
  .option('--blocking-plan-id <id>', 'Blocking plan ID')
  .option('--dep-id <id>', 'Dependency ID to delete')
  .option('--format <format>', 'Output format (json, text)', 'json')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const result = await executeCommand('dependency', action, {
        planId: options.planId,
        blockingPlanId: options.blockingPlanId,
        depId: options.depId,
      });

      printCommandResult({
        result,
        format: normalizeFormat(options.format, 'json'),
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('agent-config')
  .description('Manage agent configurations')
  .argument('<action>', 'Action to perform (list, get, delete)')
  .option('--id <id>', 'Agent config ID')
  .option('--format <format>', 'Output format (json, text)', 'json')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const result = await executeCommand('agent-config', action, {
        id: options.id,
      });

      printCommandResult({
        result,
        format: normalizeFormat(options.format, 'json'),
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .argument('<action>', 'Action to perform (whoami)')
  .option('--format <format>', 'Output format (json, text)', 'json')
  .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
  .option('--verbose', 'Print full output to stdout (useful with --output-file)', false)
  .addHelpText('after', CONVENTION_HINT)
  .action(async (action, options) => {
    try {
      const result = await executeCommand('config', action, {});

      printCommandResult({
        result,
        format: normalizeFormat(options.format, 'json'),
        outputFile: options.outputFile,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });

const updateCheckPromise = startUpdateCheck(pkg.version);

program.parse();

process.on('beforeExit', () => {
  updateCheckPromise.then((message) => {
    if (message) process.stderr.write(message);
  }).catch(() => {});
});
