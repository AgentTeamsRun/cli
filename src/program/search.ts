import {
  Command,
  CONVENTION_HINT,
  createApiKeyFileOption,
  executeCommand,
  handleError,
  printCommandResult,
} from './shared.js';

/**
 * 액션 인벤토리: 단일 액션형 커맨드. 실사용 옵션: query,types,limit,maxTokens 및 접속 옵션. limit은 유일한 페이징 옵션이며 별칭이 아님.
 */
export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description(
      'Search across all entity types (plans, co-actions, reports, post-mortems, conventions, code reviews, documents)',
    )
    .option('--query <text>', 'Search query (required)')
    .option(
      '--types <types>',
      'Comma-separated entity types to filter (PLAN, CO_ACTION, COMPLETION_REPORT, POST_MORTEM, CONVENTION, CODE_REVIEW, DOCUMENT)',
    )
    .option('--limit <n>', 'Max results (1-100, default: 20)')
    .option('--max-tokens <n>', 'Token budget for response')
    .option('--api-url <url>', 'Override API URL (optional)')
    .addOption(createApiKeyFileOption())
    .option('--project-id <id>', 'Override project ID (optional)')
    .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
    .option('--verbose', 'Print full raw output to stdout; with --output-file, also echo it', false)
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        const result = await executeCommand('search', '', {
          query: options.query,
          types: options.types,
          limit: options.limit,
          maxTokens: options.maxTokens,
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          projectId: options.projectId,
        });

        printCommandResult({
          result,
          outputFile: options.outputFile,
          verbose: options.verbose,
          resource: 'search',
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
}
