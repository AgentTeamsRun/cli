import { CREDENTIAL_ENV_KEYS } from './serverSpec.js';
import type { McpClientDefinition, McpEntryShape, McpScope, McpSecretReference, McpServerSpec } from './types.js';

function referencedSpec(spec: McpServerSpec, reference: McpSecretReference): McpServerSpec {
  if (reference !== 'opencodeEnv') return spec;
  const apiKey = spec.env[CREDENTIAL_ENV_KEYS.apiKey];
  if (apiKey !== `\${${CREDENTIAL_ENV_KEYS.apiKey}}`) return spec;
  return {
    ...spec,
    env: { ...spec.env, [CREDENTIAL_ENV_KEYS.apiKey]: `{env:${CREDENTIAL_ENV_KEYS.apiKey}}` },
  };
}

/** Serialize the AgentTeams server entry in the shape the target client expects. */
export function buildEntryValue(
  shape: McpEntryShape,
  spec: McpServerSpec,
  reference: McpSecretReference = 'dollarBraces',
): Record<string, unknown> {
  const clientSpec = referencedSpec(spec, reference);
  if (shape === 'opencode') {
    return {
      type: 'local',
      command: [clientSpec.command, ...clientSpec.args],
      environment: { ...clientSpec.env },
      enabled: true,
    };
  }

  const entry: Record<string, unknown> = {};
  if (shape === 'stdio') entry.type = 'stdio';
  entry.command = clientSpec.command;
  entry.args = [...clientSpec.args];
  entry.env = { ...clientSpec.env };
  return entry;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function renderCodexToml(serverName: string, spec: McpServerSpec): string {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(', ')}]`,
  ];

  const apiKey = spec.env[CREDENTIAL_ENV_KEYS.apiKey];
  if (apiKey === `\${${CREDENTIAL_ENV_KEYS.apiKey}}`) {
    lines.push(`env_vars = [${tomlString(CREDENTIAL_ENV_KEYS.apiKey)}]`);
  }

  const envEntries = Object.entries(spec.env).filter(
    ([key, value]) => key !== CREDENTIAL_ENV_KEYS.apiKey || value !== `\${${CREDENTIAL_ENV_KEYS.apiKey}}`,
  );
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
export function renderConfigSnippet(
  client: McpClientDefinition,
  scope: McpScope,
  spec: McpServerSpec,
  serverName: string,
): string {
  const definition = client.scopes[scope];

  if (definition.format === 'toml') {
    return renderCodexToml(serverName, spec);
  }

  const containerKey = definition.containerKey;
  const entry = buildEntryValue(definition.entryShape ?? 'plain', spec, client.secretReference);
  const document = containerKey ? { [containerKey]: { [serverName]: entry } } : { [serverName]: entry };
  return JSON.stringify(document, null, 2);
}

/** The equivalent vendor command, for users who prefer to run it themselves. */
export function renderVendorCommandLine(
  client: McpClientDefinition,
  scope: McpScope,
  spec: McpServerSpec,
  serverName: string,
): string | null {
  const vendor = client.scopes[scope].vendor;
  if (!vendor) return null;

  const args = vendor.buildArgs(spec, serverName).map((arg) => (/[\s"'$]/.test(arg) ? `'${arg}'` : arg));
  return [client.executables[0], ...args].join(' ');
}

/**
 * Strip credential values from anything that reaches a terminal, a log or a
 * test snapshot. Vendor CLIs echo their own arguments on failure, so their
 * captured output has to pass through here before it is shown.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    redacted = redacted.split(secret).join('***');
  }
  return redacted;
}
