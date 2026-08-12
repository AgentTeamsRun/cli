import {
  Command,
  Option,
  CONVENTION_HINT,
  DEVICE_AUTH_OPTION_DESCRIPTION,
  DEVICE_AUTH_SET_DEFAULT_DESCRIPTION,
  executeCommand,
  handleError,
  normalizeInteractiveFormat,
  printInitResult,
} from './shared.js';

/**
 * 액션 인벤토리: 액션: start. 실사용 옵션: authMode, agentFiles, agentFilesExample, installWorktreeHook, deviceAuth, setDefault. 별칭/도움말 불일치: 없음.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize AgentTeams CLI via OAuth')
    // No commander `.default()` on purpose: init has to tell "the user asked for
    // this credential" apart from "nothing was typed". A default would fill
    // `options.auth` on every run, and `detectInitExecutionContext` reads a
    // present value as an explicit relink request — which would make the
    // configured-project fast path unreachable from the real CLI. The absent case
    // is defaulted in `executeInitCommandWithContext`.
    .addOption(
      new Option(
        '--auth <mode>',
        'Credential to configure. `personal-token` (default) stores a rotating personal login outside the repository — in the OS credential store, or in a permission-protected file when that store is unavailable — and refreshes itself; `api-key` writes a legacy agent key into .agentteams/config.json, which expires 30 days after issue and must be reissued by hand.',
      ).choices(['api-key', 'personal-token']),
    )
    // Entry point files are no longer written for every AI client on every run.
    // Without a TTY the selection now comes from what is actually configured in
    // the folder (.claude/, .cursor/, …), and this option is how an automated
    // caller states the set explicitly instead.
    .option(
      '--agent-files <list>',
      "Comma-separated agent entry point files to create (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules/agentteams.mdc), or 'none'. Defaults to the AI clients detected in this folder.",
    )
    .option(
      '--agent-files-example',
      'When a selected entry point file already exists, write a <name>-example file next to it instead of leaving it alone.',
      false,
    )
    .option(
      '--install-worktree-hook',
      "Install the managed git post-checkout hook even if this repository has no linked worktrees yet. By default the hook is installed only when linked worktrees exist; 'agentteams doctor' can install it later.",
      false,
    )
    // Explicit opt-in only. There is deliberately no `--no-device-auth`: the default
    // already is the browser callback, so the way to turn this off is not to pass it.
    .option('--device-auth', DEVICE_AUTH_OPTION_DESCRIPTION, false)
    .option('--set-default', DEVICE_AUTH_SET_DEFAULT_DESCRIPTION, false)
    .option('--format <format>', 'Output format (json; defaults to human-readable view)')
    .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
    .option('--verbose', 'Print full raw output to stdout; with --output-file, also echo it', false)
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        const result = await executeCommand('init', 'start', {
          authMode: options.auth,
          agentFiles: options.agentFiles,
          agentFilesExample: options.agentFilesExample === true,
          installWorktreeHook: options.installWorktreeHook === true,
          deviceAuth: options.deviceAuth === true,
          setDefault: options.setDefault === true,
        });
        const format = normalizeInteractiveFormat(options.format);

        printInitResult(result, format);
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
}
