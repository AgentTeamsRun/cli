import {
  Command,
  CONVENTION_HINT,
  executeCommand,
  executeValidatedInteractiveCommand,
  handleError,
  printDoctorResult,
  resolveDoctorExitCode,
} from './shared.js';
import type { DoctorResult } from './shared.js';

/**
 * 액션 인벤토리: 액션: run. 실사용 옵션: cwd, installWorktreeHook. 별칭/도움말 불일치: 없음.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose convention reachability and install the worktree bootstrap hook')
    .option('--format <format>', 'Output format (json; defaults to human-readable view)')
    // The doctor honors the same gate `init` does — a repository with no linked
    // worktree keeps its shared .git/hooks untouched — so opting in needs a flag
    // on this command too, not just on `init`.
    .option(
      '--install-worktree-hook',
      'Install the managed git post-checkout hook even if this repository has no linked worktrees yet.',
      false,
    )
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        const { result, format } = await executeValidatedInteractiveCommand(options.format, async () =>
          executeCommand('doctor', 'run', {
            cwd: process.cwd(),
            installWorktreeHook: options.installWorktreeHook === true,
          }),
        );

        printDoctorResult(result as DoctorResult, format);
        // exitCode (not process.exit) lets stdout flush before termination.
        process.exitCode = resolveDoctorExitCode(result as DoctorResult);
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
}
