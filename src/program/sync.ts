import {
  Command,
  CONVENTION_HINT,
  executeCommand,
  handleError,
  normalizeInteractiveFormat,
  printCommandResult,
} from './shared.js';

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatSyncHumanOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'Sync completed.';

  const sync = result as Record<string, unknown>;
  const lines: string[] = [];
  const message = readString(sync.message);
  const warning = readString(sync.warning);

  if (message) lines.push(message);
  if (warning) {
    lines.push(warning);
  } else if (Array.isArray(sync.unmanagedFiles) && sync.unmanagedFiles.length > 0) {
    lines.push(`Unmanaged convention files: ${sync.unmanagedFiles.map(String).join(', ')}`);
  }

  if (sync.skills && typeof sync.skills === 'object' && !Array.isArray(sync.skills)) {
    const skills = sync.skills as Record<string, unknown>;
    const skillMessage = readString(skills.message);
    const skillWarning = readString(skills.warning);
    if (skillMessage) lines.push(skillMessage);
    if (skillWarning) lines.push(skillWarning);
  }

  return lines.length > 0 ? lines.join('\n') : 'Sync completed.';
}

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
          console.log(formatSyncHumanOutput(result));
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
