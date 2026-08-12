import {
  Command,
  CONVENTION_HINT,
  MCP_CLIENT_IDS,
  createApiKeyFileOption,
  formatOutput,
  handleError,
} from './shared.js';

/**
 * 액션 인벤토리: 액션: server(부모), config/install/doctor. 등록 액션은 client/scope/toolProfile/serverEntry/json 및 접속 옵션, install만 yes, doctor는 yes/json. 별칭 없음.
 */
export function registerMcpCommand(program: Command): void {
  const mcpCommand = program
    .command('mcp')
    .description('Run an MCP server over stdio, exposing AgentTeams reads to MCP-capable coding agents')
    .option(
      '--tool-profile <profile>',
      'Tool catalog profile (full, read, documents, comments, minimal); full is the compatibility default, limited profiles reduce upfront schemas',
      'full',
    )
    .option('--api-url <url>', 'Override API URL (optional)')
    .addOption(createApiKeyFileOption())
    .option('--project-id <id>', 'Override project ID (optional)')
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        // Loaded lazily so the MCP SDK — which requires a newer Node than some of
        // the CLI's other commands need — never enters the other command paths.
        const { startMcpServer } = await import('../commands/mcp.js');

        // stdout carries JSON-RPC frames only: this action deliberately bypasses
        // executeCommand()/printCommandResult() and never writes to stdout.
        await startMcpServer({
          apiUrl: options.apiUrl,
          apiKey: options.apiKey,
          projectId: options.projectId,
          toolProfile: options.toolProfile,
        });
      } catch (error) {
        // Staying alive without credentials would make the client retry forever.
        console.error(handleError(error));
        process.exit(1);
      }
    });

  const MCP_CLIENT_CHOICES = MCP_CLIENT_IDS.join(', ');

  function addMcpRegistrationOptions(command: Command): Command {
    return command
      .option('--client <id>', `Target client (${MCP_CLIENT_CHOICES})`)
      .option('--scope <scope>', 'Configuration scope (user, project)', 'project')
      .option(
        '--tool-profile <profile>',
        'Tool catalog profile (full, read, documents, comments, minimal); full is the compatibility default, limited profiles reduce upfront schemas. A client whose backend rejects part of the catalog is narrowed automatically unless you name a profile here',
      )
      .option(
        '--server-entry <path>',
        'Use a local `cli/dist/index.js` instead of the published package (for pre-release testing)',
      )
      .option('--json', 'Print the machine-readable result instead of the human-readable report', false)
      .option('--api-url <url>', 'Override API URL (optional)')
      .addOption(createApiKeyFileOption())
      .option('--project-id <id>', 'Override project ID (optional)');
  }

  /**
   * The registration surface is loaded lazily for the same reason the server is:
   * `agentteams mcp` must stay a thin stdio entry point, and no other command
   * should pay for the client registry.
   */
  async function runMcpRegistration(
    action: 'config' | 'install',
    options: Record<string, unknown>,
    command: Command,
  ): Promise<void> {
    try {
      const parentOptions = command.parent?.opts() ?? {};
      const merged = { ...parentOptions, ...options } as Record<string, unknown>;
      const { runMcpConfigCommand, runMcpInstallCommand } = await import('../mcp-registration/index.js');
      const output = action === 'config' ? runMcpConfigCommand(merged) : runMcpInstallCommand(merged);

      console.log(options.json ? formatOutput(output.json) : output.text);
      process.exitCode = output.exitCode;
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  }

  addMcpRegistrationOptions(
    mcpCommand
      .command('config')
      .description('Print the MCP configuration snippet for a coding agent. Never writes files or credentials.'),
  )
    .addHelpText('after', CONVENTION_HINT)
    .action((options, command: Command) => runMcpRegistration('config', options, command));

  addMcpRegistrationOptions(
    mcpCommand
      .command('install')
      .description(
        'Register AgentTeams with local MCP clients. Without --client it only prints a detection plan; batch apply requires --scope user --yes.',
      ),
  )
    .option('--yes', 'Apply an explicitly selected user-scope batch plan instead of only printing it', false)
    .addHelpText('after', CONVENTION_HINT)
    .action((options, command: Command) => runMcpRegistration('install', options, command));

  mcpCommand
    .command('doctor')
    .description('Find legacy plaintext MCP key copies; cleanup is applied only with explicit --yes confirmation.')
    .option('--yes', 'Confirm safe cleanup after the audit', false)
    .option('--json', 'Print the machine-readable result instead of the human-readable report', false)
    .addHelpText('after', CONVENTION_HINT)
    .action(async (options) => {
      try {
        const { runMcpDoctorCommand } = await import('../mcp-registration/doctor.js');
        const output = await runMcpDoctorCommand({ yes: options.yes === true });
        console.log(options.json ? formatOutput(output.json) : output.text);
        process.exitCode = output.exitCode;
      } catch (error) {
        console.error(handleError(error));
        process.exit(1);
      }
    });
}
