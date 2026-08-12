import {
  Command,
  CONVENTION_HINT,
  DEVICE_AUTH_OPTION_DESCRIPTION,
  DEVICE_AUTH_SET_DEFAULT_DESCRIPTION,
  executeCommand,
  formatAuthResultText,
  handleError,
  normalizeFormat,
  printCommandResult,
} from './shared.js';
import { addOutputOptions } from './options/output.js';

export function registerAuthCommand(program: Command): void {
  const root = program
    .command('auth')
    .description('Manage the personal AgentTeams login used by default')
    .addHelpText('after', CONVENTION_HINT);
  const addLeaf = (
    action: string,
    description: string,
    configure: (command: Command) => Command = (command) => command,
  ) => {
    const configured = configure(root.command(action).description(description));
    const command = addOutputOptions(
      configured.option('--format <format>', 'Output format (json; defaults to human-readable text)'),
    ).addHelpText('after', CONVENTION_HINT);
    command.action(async (options) => {
      try {
        const { outputFile, verbose, format, ...actionOptions } = options;
        // json 외의 값은 여기서 거절합니다(출력 자체는 아래 분기가 결정).
        normalizeFormat(format);
        const result = await executeCommand('auth', action, actionOptions);
        const wantsJson = format !== undefined;
        printCommandResult({
          result: wantsJson ? result : formatAuthResultText(action, result),
          outputFile,
          verbose,
        });
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
  };
  addLeaf('login', 'Log in to AgentTeams', (command) =>
    command
      .option('--api-url <url>', 'API server to authenticate against')
      .option('--device-auth', DEVICE_AUTH_OPTION_DESCRIPTION, false)
      .option('--set-default', DEVICE_AUTH_SET_DEFAULT_DESCRIPTION, false),
  );
  addLeaf('status', 'Show login status', (command) => command.option('--api-url <url>', 'API server to query'));
  addLeaf('logout', 'Log out of AgentTeams', (command) =>
    command
      .option('--api-url <url>', 'API server to contact')
      .option('--local', 'Clear only the local credential', false),
  );
}
