import { join } from 'node:path';
import type { McpClientDefinition, McpClientId, McpPathContext, McpServerSpec } from './types.js';

/**
 * Registry of the eight AgentTeams runner engines that can host an MCP client.
 *
 * Every entry below was verified on 2026-07-25 against the vendor's public docs
 * *and* against a local install (`<tool> mcp add --help`, plus a two-run
 * idempotency check where the tool ships a registration command). The
 * `verifiedAt` / `docsUrl` fields exist so a future contract drift is traceable
 * to the day the claim was made.
 *
 * Deliberate exclusions: Orca is a worktree runner environment, not an MCP
 * client (register the agents it launches instead), and `GEMINI` is a
 * deprecated runner type.
 *
 * `runnerType` mirrors `packages/core-constants`'s `RUNNER_TYPES`. The public
 * CLI is published from a `cli/`-only subtree split, so that private package
 * cannot be a runtime dependency; a monorepo-only drift test asserts the two
 * key sets stay identical instead.
 */

function xdgConfigHome(context: McpPathContext): string {
  const override = context.env.XDG_CONFIG_HOME;
  return override && override.length > 0 ? override : join(context.homeDir, '.config');
}

function kimiHome(context: McpPathContext): string {
  const override = context.env.KIMI_CODE_HOME;
  return override && override.length > 0 ? override : join(context.homeDir, '.kimi-code');
}

function codexHome(context: McpPathContext): string {
  const override = context.env.CODEX_HOME;
  return override && override.length > 0 ? override : join(context.homeDir, '.codex');
}

function copilotHome(context: McpPathContext): string {
  const override = context.env.COPILOT_HOME;
  return override && override.length > 0 ? override : join(context.homeDir, '.copilot');
}

function envFlags(spec: McpServerSpec, flag: string): string[] {
  return Object.entries(spec.env).flatMap(([key, value]) => [flag, `${key}=${value}`]);
}

const ALREADY_REGISTERED = [/already exists/i];

export const MCP_CLIENTS: McpClientDefinition[] = [
  {
    id: 'claude-code',
    runnerType: 'CLAUDE_CODE',
    label: 'Claude Code',
    executables: ['claude'],
    secretReference: 'dollarBraces',
    configSignals: (context) => [join(context.homeDir, '.claude.json'), join(context.homeDir, '.claude')],
    docsUrl: 'https://code.claude.com/docs/en/mcp',
    verifiedAt: '2026-07-25',
    scopes: {
      user: {
        configPath: (context) => join(context.homeDir, '.claude.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'stdio',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'stdio',
        strategy: 'vendorCommand',
        vendor: {
          buildArgs: (spec, name) => [
            'mcp',
            'add',
            name,
            '--scope',
            'project',
            ...envFlags(spec, '-e'),
            '--',
            spec.command,
            ...spec.args,
          ],
          rerunBehavior: 'refuse',
          alreadyRegisteredPatterns: ALREADY_REGISTERED,
        },
      },
    },
  },
  {
    id: 'codex',
    runnerType: 'CODEX',
    label: 'Codex',
    executables: ['codex'],
    secretReference: 'codexEnvVars',
    configSignals: (context) => [join(codexHome(context), 'config.toml'), codexHome(context)],
    docsUrl: 'https://developers.openai.com/codex/mcp',
    verifiedAt: '2026-07-25',
    scopes: {
      user: {
        configPath: (context) => join(codexHome(context), 'config.toml'),
        format: 'toml',
        strategy: 'configOnly',
        configOnlyReason:
          'Codex inherits secrets through `env_vars`, but `codex mcp add --env` accepts values only through argv. The CLI therefore prints a safe TOML snippet instead of exposing the API key in the process list.',
      },
      project: {
        configPath: (context) => join(context.cwd, '.codex', 'config.toml'),
        format: 'toml',
        strategy: 'configOnly',
        configOnlyReason:
          'Codex project config is TOML and `codex mcp add` only targets the user config. The CLI has no comment-preserving TOML editor, so rewriting the file would drop your comments and key order.',
      },
    },
  },
  {
    id: 'copilot-cli',
    runnerType: 'COPILOT_CLI',
    label: 'GitHub Copilot CLI',
    executables: ['copilot'],
    secretReference: 'dollarBraces',
    configSignals: (context) => [join(copilotHome(context), 'mcp-config.json'), copilotHome(context)],
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
    verifiedAt: '2026-07-25',
    scopes: {
      user: {
        configPath: (context) => join(copilotHome(context), 'mcp-config.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'stdio',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'stdio',
        strategy: 'jsonMerge',
      },
    },
  },
  {
    id: 'opencode',
    runnerType: 'OPENCODE',
    label: 'OpenCode',
    executables: ['opencode'],
    secretReference: 'opencodeEnv',
    configSignals: (context) => [
      join(xdgConfigHome(context), 'opencode', 'opencode.jsonc'),
      join(xdgConfigHome(context), 'opencode', 'opencode.json'),
      join(xdgConfigHome(context), 'opencode'),
    ],
    docsUrl: 'https://opencode.ai/docs/mcp-servers',
    verifiedAt: '2026-07-25',
    scopes: {
      user: {
        configPath: (context) => join(xdgConfigHome(context), 'opencode', 'opencode.jsonc'),
        format: 'jsonc',
        containerKey: 'mcp',
        entryShape: 'opencode',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, 'opencode.json'),
        format: 'json',
        containerKey: 'mcp',
        entryShape: 'opencode',
        strategy: 'jsonMerge',
      },
    },
  },
  {
    id: 'amp',
    runnerType: 'AMP',
    label: 'Amp',
    executables: ['amp'],
    secretReference: 'dollarBraces',
    configSignals: (context) => [
      join(xdgConfigHome(context), 'amp', 'settings.json'),
      join(xdgConfigHome(context), 'amp'),
    ],
    docsUrl: 'https://ampcode.com/manual',
    verifiedAt: '2026-07-25',
    scopes: {
      user: {
        configPath: (context) => join(xdgConfigHome(context), 'amp', 'settings.json'),
        format: 'json',
        containerKey: 'amp.mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.amp', 'settings.json'),
        format: 'json',
        containerKey: 'amp.mcpServers',
        entryShape: 'plain',
        strategy: 'vendorCommand',
        vendor: {
          buildArgs: (spec, name) => [
            'mcp',
            'add',
            name,
            '--workspace',
            ...envFlags(spec, '--env'),
            '--',
            spec.command,
            ...spec.args,
          ],
          rerunBehavior: 'refuse',
          alreadyRegisteredPatterns: ALREADY_REGISTERED,
        },
      },
    },
  },
  {
    id: 'cursor-cli',
    runnerType: 'CURSOR_CLI',
    label: 'Cursor CLI',
    executables: ['cursor-agent'],
    secretReference: 'dollarBraces',
    configSignals: (context) => [join(context.homeDir, '.cursor', 'mcp.json'), join(context.homeDir, '.cursor')],
    docsUrl: 'https://docs.cursor.com/context/model-context-protocol',
    verifiedAt: '2026-07-25',
    scopes: {
      // Verified 2026.07.16: `cursor-agent mcp` exposes only login/list/enable/
      // disable — there is no `add`, so the config file is the only contract.
      user: {
        configPath: (context) => join(context.homeDir, '.cursor', 'mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.cursor', 'mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
    },
  },
  {
    id: 'kimi-cli',
    runnerType: 'KIMI_CLI',
    label: 'Kimi CLI',
    executables: ['kimi'],
    secretReference: 'dollarBraces',
    extraBinDirs: (context) => [join(kimiHome(context), 'bin')],
    configSignals: (context) => [join(kimiHome(context), 'mcp.json'), kimiHome(context)],
    docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html',
    verifiedAt: '2026-07-25',
    scopes: {
      // Verified 0.29.0: kimi-code exposes no `mcp` subcommand at all; it loads
      // `<KIMI_CODE_HOME>/mcp.json` and `<cwd>/.kimi-code/mcp.json` directly.
      user: {
        configPath: (context) => join(kimiHome(context), 'mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.kimi-code', 'mcp.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
    },
  },
  {
    id: 'antigravity',
    runnerType: 'ANTIGRAVITY',
    label: 'Antigravity',
    executables: ['agy', 'antigravity'],
    secretReference: 'dollarBraces',
    configSignals: (context) => [
      join(context.homeDir, '.gemini', 'config', 'mcp_config.json'),
      join(context.homeDir, '.gemini', 'antigravity'),
    ],
    docsUrl: 'https://antigravity.google/docs/mcp',
    verifiedAt: '2026-07-25',
    scopes: {
      // Verified 1.1.2: the `agy` CLI has no `mcp` subcommand; `mcp_config.json`
      // with an `mcpServers` map is the documented contract.
      user: {
        configPath: (context) => join(context.homeDir, '.gemini', 'config', 'mcp_config.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
      project: {
        configPath: (context) => join(context.cwd, '.agents', 'mcp_config.json'),
        format: 'json',
        containerKey: 'mcpServers',
        entryShape: 'plain',
        strategy: 'jsonMerge',
      },
    },
  },
];

export function findClient(clientId: string): McpClientDefinition | undefined {
  return MCP_CLIENTS.find((client) => client.id === clientId);
}

export function listClientIds(): McpClientId[] {
  return MCP_CLIENTS.map((client) => client.id);
}
