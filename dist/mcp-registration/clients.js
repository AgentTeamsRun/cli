import { join } from 'node:path';
/**
 * Registry of the AgentTeams runner engines that can host an MCP client.
 *
 * Every entry below was verified on 2026-07-25 (kiro-cli: 2026-08-08) against the vendor's public docs
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
function xdgConfigHome(context) {
    const override = context.env.XDG_CONFIG_HOME;
    return override && override.length > 0 ? override : join(context.homeDir, '.config');
}
function kimiHome(context) {
    const override = context.env.KIMI_CODE_HOME;
    return override && override.length > 0 ? override : join(context.homeDir, '.kimi-code');
}
function kiroHome(context) {
    // Verified 2.16.2: `KIRO_HOME=<dir> kiro-cli mcp list` loads `<dir>/settings/mcp.json`,
    // so writing to `~/.kiro` under an override would register into a file Kiro never reads.
    const override = context.env.KIRO_HOME;
    return override && override.length > 0 ? override : join(context.homeDir, '.kiro');
}
function codexHome(context) {
    const override = context.env.CODEX_HOME;
    return override && override.length > 0 ? override : join(context.homeDir, '.codex');
}
function copilotHome(context) {
    const override = context.env.COPILOT_HOME;
    return override && override.length > 0 ? override : join(context.homeDir, '.copilot');
}
function envFlags(spec, flag) {
    return Object.entries(spec.env).flatMap(([key, value]) => [flag, `${key}=${value}`]);
}
const ALREADY_REGISTERED = [/already exists/i];
export const MCP_CLIENTS = [
    {
        id: 'claude-code',
        runnerType: 'CLAUDE_CODE',
        label: 'Claude Code',
        executables: ['claude'],
        configSignals: (context) => [join(context.homeDir, '.claude.json'), join(context.homeDir, '.claude')],
        docsUrl: 'https://code.claude.com/docs/en/mcp',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'verified',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search',
            version: '2.1.220',
            reason: 'Tool Search is enabled by default and defers MCP tool definitions until they are needed.',
        },
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
        configSignals: (context) => [join(codexHome(context), 'config.toml'), codexHome(context)],
        docsUrl: 'https://developers.openai.com/codex/mcp',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'unknown',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://developers.openai.com/codex/mcp',
            version: '0.144.5',
            reason: 'The official Codex MCP feature list does not document host-side progressive tool discovery.',
        },
        scopes: {
            user: {
                configPath: (context) => join(codexHome(context), 'config.toml'),
                format: 'toml',
                strategy: 'configOnly',
                configOnlyReason: 'Codex user config is TOML. The CLI prints a complete snippet instead of rewriting that user-owned file and dropping comments or key order.',
            },
            project: {
                configPath: (context) => join(context.cwd, '.codex', 'config.toml'),
                format: 'toml',
                strategy: 'configOnly',
                configOnlyReason: 'Codex project config is TOML and `codex mcp add` only targets the user config. The CLI has no comment-preserving TOML editor, so rewriting the file would drop your comments and key order.',
            },
        },
    },
    {
        id: 'copilot-cli',
        runnerType: 'COPILOT_CLI',
        label: 'GitHub Copilot CLI',
        executables: ['copilot'],
        configSignals: (context) => [join(copilotHome(context), 'mcp-config.json'), copilotHome(context)],
        docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'verified',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://docs.github.com/en/copilot/concepts/agents/copilot-cli/tool-search',
            version: '1.0.75',
            reason: 'Tool search defers external tools on supported models once the client tool inventory crosses its threshold.',
        },
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
        configSignals: (context) => [
            join(xdgConfigHome(context), 'opencode', 'opencode.jsonc'),
            join(xdgConfigHome(context), 'opencode', 'opencode.json'),
            join(xdgConfigHome(context), 'opencode'),
        ],
        docsUrl: 'https://opencode.ai/docs/mcp-servers',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'unsupported',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://opencode.ai/docs/mcp-servers#caveats',
            version: '1.17.7',
            reason: 'The official guide says MCP tools add directly to model context and recommends enabling fewer servers.',
        },
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
        configSignals: (context) => [
            join(xdgConfigHome(context), 'amp', 'settings.json'),
            join(xdgConfigHome(context), 'amp'),
        ],
        docsUrl: 'https://ampcode.com/manual',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'unsupported',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://ampcode.com/manual#mcp',
            version: '0.0.1783228622-g9b591b',
            reason: 'MCP servers registered in Amp settings stay available in context; on-demand loading is limited to MCP servers bundled in skills.',
        },
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
        configSignals: (context) => [join(context.homeDir, '.cursor', 'mcp.json'), join(context.homeDir, '.cursor')],
        docsUrl: 'https://docs.cursor.com/context/model-context-protocol',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'verified',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://cursor.com/blog/dynamic-context-discovery#4-efficiently-loading-only-the-mcp-tools-needed',
            version: '2026.07.16-899851b',
            reason: 'Cursor syncs MCP tool descriptions outside the prompt and loads matching definitions when needed.',
        },
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
        extraBinDirs: (context) => [join(kimiHome(context), 'bin')],
        configSignals: (context) => [join(kimiHome(context), 'mcp.json'), kimiHome(context)],
        docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'unknown',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html',
            reason: 'The official MCP guide documents allowlists and exposure to the agent, but not progressive definition loading.',
        },
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
        configSignals: (context) => [
            join(context.homeDir, '.gemini', 'config', 'mcp_config.json'),
            join(context.homeDir, '.gemini', 'antigravity'),
        ],
        docsUrl: 'https://antigravity.google/docs/mcp',
        verifiedAt: '2026-07-25',
        nativeDiscovery: {
            status: 'unknown',
            verifiedAt: '2026-08-02',
            evidenceUrl: 'https://antigravity.google/docs/mcp',
            version: '1.1.8',
            reason: 'The official MCP guide documents automatic availability and permissions, but not progressive definition loading.',
        },
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
    {
        id: 'kiro-cli',
        runnerType: 'KIRO_CLI',
        label: 'Kiro CLI',
        executables: ['kiro-cli'],
        // Verified 2.16.2 on macOS: the installer drops a symlink in `~/.local/bin`
        // that points into the app bundle, and widens PATH through the shell rc —
        // which a GUI-launched client never reads. Only home-relative paths belong
        // here; the macOS app-bundle location is machine-absolute and would make
        // detection ignore the caller's context (the daemon keeps that fallback
        // instead, where resolving the real binary is the point).
        extraBinDirs: (context) => [join(context.homeDir, '.local', 'bin')],
        configSignals: (context) => [join(kiroHome(context), 'settings', 'mcp.json'), kiroHome(context)],
        docsUrl: 'https://kiro.dev/docs/mcp/',
        verifiedAt: '2026-08-08',
        nativeDiscovery: {
            status: 'unknown',
            verifiedAt: '2026-08-08',
            evidenceUrl: 'https://kiro.dev/docs/mcp/',
            version: '2.16.2',
            reason: 'The official Kiro MCP guide does not document host-side progressive tool definition loading.',
        },
        // Verified 2.16.2: Kiro's Bedrock backend rejects a tool whose `input_schema`
        // is a top-level union (`anyOf`) with a 400 — and it fails the *whole*
        // request, so a single such tool makes every Kiro conversation unusable, not
        // just the tool call. Registration therefore falls back to a union-free
        // profile instead of reporting INSTALLED on a config that bricks the client.
        //
        // As of 2026-08-08 this narrows nothing in practice: the two comment tools
        // that carried a union root were flattened, so the whole catalog is
        // union-free and Kiro registers on `full`. The constraint stays declared
        // because the resolver reads the *live* catalog and conservatively scans
        // every schema depth — the day a tool ships any union again, Kiro falls back
        // on its own instead of bricking.
        schemaConstraint: {
            kind: 'topLevelUnion',
            fallbackToolProfile: 'documents',
            reason: "Kiro's Bedrock backend rejects a tool whose input schema is a top-level union, and the 400 fails every request in the conversation — not only the tool call.",
        },
        scopes: {
            // Verified 2.16.2: `kiro-cli mcp add --scope global|workspace` reports the
            // exact files below, and writes a `mcpServers` map of
            // `{ command, args, env }` — the same shape this registry merges. We merge
            // the file directly rather than shelling out so registration does not
            // depend on the CLI being installed at the time `mcp config` runs.
            //
            // Verified 2.16.2 that a plain `chat --no-interactive` run does load the
            // global mcp.json (a deliberately broken entry plus `--require-mcp-startup`
            // exits 3). Runs that pass `--agent`, however, only inherit it while the
            // agent config keeps `includeMcpJson` at its default `true`; an agent that
            // sets it to false silently ignores this registration.
            user: {
                configPath: (context) => join(kiroHome(context), 'settings', 'mcp.json'),
                format: 'json',
                containerKey: 'mcpServers',
                entryShape: 'plain',
                strategy: 'jsonMerge',
            },
            project: {
                configPath: (context) => join(context.cwd, '.kiro', 'settings', 'mcp.json'),
                format: 'json',
                containerKey: 'mcpServers',
                entryShape: 'plain',
                strategy: 'jsonMerge',
            },
        },
    },
];
export function findClient(clientId) {
    return MCP_CLIENTS.find((client) => client.id === clientId);
}
export function listClientIds() {
    return MCP_CLIENTS.map((client) => client.id);
}
//# sourceMappingURL=clients.js.map