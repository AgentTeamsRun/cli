/** Serialize the AgentTeams server entry in the shape the target client expects. */
export function buildEntryValue(shape, spec) {
    if (shape === 'opencode') {
        return {
            type: 'local',
            command: [spec.command, ...spec.args],
            environment: { ...spec.env },
            enabled: true,
        };
    }
    const entry = {};
    if (shape === 'stdio')
        entry.type = 'stdio';
    if (shape === 'muse')
        entry.transport = 'stdio';
    entry.command = spec.command;
    entry.args = [...spec.args];
    entry.env = { ...spec.env };
    return entry;
}
function tomlString(value) {
    return JSON.stringify(value);
}
function renderCodexToml(serverName, spec) {
    const lines = [
        `[mcp_servers.${serverName}]`,
        `command = ${tomlString(spec.command)}`,
        `args = [${spec.args.map(tomlString).join(', ')}]`,
    ];
    const envEntries = Object.entries(spec.env);
    if (envEntries.length > 0) {
        lines.push('', `[mcp_servers.${serverName}.env]`);
        for (const [key, value] of envEntries) {
            lines.push(`${key} = ${tomlString(value)}`);
        }
    }
    return lines.join('\n');
}
/**
 * The copy-pasteable config fragment for one client/scope. This is the escape
 * hatch every failure path points at, so it must be complete on its own: the
 * full container wrapper, not just the inner entry.
 */
export function renderConfigSnippet(client, scope, spec, serverName) {
    const definition = client.scopes[scope];
    if (definition.format === 'toml') {
        return renderCodexToml(serverName, spec);
    }
    const containerKey = definition.containerKey;
    const entry = buildEntryValue(definition.entryShape ?? 'plain', spec);
    const document = containerKey ? { [containerKey]: { [serverName]: entry } } : { [serverName]: entry };
    return JSON.stringify({ ...definition.requiredRootValues, ...document }, null, 2);
}
/** The equivalent vendor command, for users who prefer to run it themselves. */
export function renderVendorCommandLine(client, scope, spec, serverName) {
    const vendor = client.scopes[scope].vendor;
    if (!vendor)
        return null;
    const args = vendor.buildArgs(spec, serverName).map((arg) => (/[\s"'$]/.test(arg) ? `'${arg}'` : arg));
    return [client.executables[0], ...args].join(' ');
}
/**
 * Strip AgentTeams key material from vendor output before it reaches a terminal or a log.
 *
 * Registration itself no longer holds a credential — the server spec embeds nothing — so
 * there is no value to pass in. What remains is that vendor CLIs echo their own argv and
 * environment on failure, and that output can carry a `key_` this process never saw.
 */
export function redactKeyMaterial(text) {
    return text.replace(/(?<![A-Za-z0-9_-])key_[A-Za-z0-9][A-Za-z0-9_-]{7,}/g, '***');
}
//# sourceMappingURL=render.js.map