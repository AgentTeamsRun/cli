import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
/** Server name registered in every client. Kept stable so re-runs update rather than duplicate. */
export const MCP_SERVER_NAME = 'agentteams';
/** Published package the `npx` fallback runs. */
export const MCP_RUNTIME_PACKAGE = '@agentteams/cli';
/** Name of the globally installed executable, when there is one. */
export const MCP_GLOBAL_EXECUTABLE = 'agentteams';
function profileArgs(toolProfile = 'full') {
    return toolProfile === 'full' ? [] : ['--tool-profile', toolProfile];
}
function executableSuffixes() {
    return process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat', '.ps1'] : [''];
}
/** Is a bare `agentteams` resolvable from this context's PATH? */
export function hasGlobalExecutable(context, fileExists = existsSync) {
    const pathDirs = (context.env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0);
    for (const directory of pathDirs) {
        for (const suffix of executableSuffixes()) {
            if (fileExists(join(directory, `${MCP_GLOBAL_EXECUTABLE}${suffix}`)))
                return true;
        }
    }
    return false;
}
/**
 * What the client will spawn.
 *
 * A bare `agentteams` is the fast path, but it is only correct when the package is
 * installed globally *and* the client inherits a PATH that contains it — neither holds
 * for `npx @agentteams/cli mcp install` or for a GUI-launched client that never sourced
 * a login shell. Those failures surface as an opaque "server failed to start" inside the
 * client, so when the executable is not resolvable the spec falls back to `npx`, which
 * works in both cases.
 */
export function buildServerSpec(options) {
    const { serverEntry } = options;
    const env = {};
    const args = profileArgs(options.toolProfile);
    if (serverEntry) {
        const entryPath = isAbsolute(serverEntry) ? serverEntry : resolve(serverEntry);
        return { command: 'node', args: [entryPath, 'mcp', ...args], env };
    }
    if (options.context && !hasGlobalExecutable(options.context, options.fileExists)) {
        return { command: 'npx', args: ['-y', MCP_RUNTIME_PACKAGE, 'mcp', ...args], env };
    }
    return { command: MCP_GLOBAL_EXECUTABLE, args: ['mcp', ...args], env };
}
//# sourceMappingURL=serverSpec.js.map