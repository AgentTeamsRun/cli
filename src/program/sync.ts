import {
  Command,
  CONVENTION_HINT,
  executeCommand,
  formatOutput,
  handleError,
  normalizeInteractiveFormat,
  printCommandResult,
} from './shared.js';

/**
 * 액션 인벤토리: 액션: download. 실사용 옵션: cwd. 별칭/도움말 불일치: 없음.
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync local convention files from API')
    .option('--format <format>', 'Output format (json; defaults to human-readable view)')
    .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
    .option('--verbose', 'Print full raw output to stdout; with --output-file, also echo it', false)
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        const result = await executeCommand('sync', 'download', {
          cwd: process.cwd(),
        });
        const format = normalizeInteractiveFormat(options.format);

        if (format === 'human' && !options.outputFile) {
          console.log(typeof result === 'string' ? result : formatOutput(result));
          return;
        }

        printCommandResult({
          result: format === 'json' && typeof result === 'string' ? { message: result } : result,
          outputFile: options.outputFile,
          verbose: options.verbose,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
}
