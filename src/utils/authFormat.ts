/**
 * Human-readable rendering of `agentteams auth` results.
 *
 * `auth` is read by a person deciding what to do next — "am I signed in, as whom,
 * and against which server" — not by a script assembling a payload. The JSON view
 * is still available behind an explicit `--format json` for the scripts that read
 * the documented fields.
 *
 * Lines are `Label: value` so the output stays greppable, and every line answers a
 * question a user actually asks. Anything the payload does not contain is omitted
 * rather than printed as `null`.
 */

type AuthIdentity = { memberId?: unknown; email?: unknown; nickname?: unknown } | null | undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** `nickname <email>`, falling back to whichever half is present. */
function describeIdentity(identity: AuthIdentity): string | undefined {
  const record = asRecord(identity);
  const email = asString(record.email);
  const nickname = asString(record.nickname);
  if (email && nickname) return `${nickname} <${email}>`;
  return email ?? nickname ?? asString(record.memberId);
}

const STORE_BACKEND_LABELS: Record<string, string> = {
  'macos-keychain': 'macOS keychain',
  'windows-credential-manager': 'Windows Credential Manager',
  libsecret: 'libsecret (Secret Service)',
  'protected-file': 'protected file (~/.agentteams/credentials)',
  none: 'none',
};

/**
 * The one thing a user must not have to infer.
 *
 * The file backend is protected by filesystem permissions, not by the OS keyring's
 * encryption, and someone reading `Stored in: protected file` is entitled to know
 * the difference before deciding whether that machine should hold a login at all.
 */
const FILE_BACKEND_WARNING =
  'This machine could not use its OS credential store, so the login is kept in a file only your account can read. ' +
  'That is weaker than the OS keyring: anyone who can read your files or escalate on this machine can read the token.';

function isFileBackend(backend: unknown): boolean {
  return String(backend) === 'protected-file';
}

/** "macOS keychain (OK)" — the backend plus why it can or cannot persist. */
function describeStore(backend: unknown, reason: unknown, persisted: unknown, detail?: unknown): string | undefined {
  const backendLabel = STORE_BACKEND_LABELS[String(backend)] ?? asString(backend);
  if (!backendLabel) return undefined;

  const reasonLabel = asString(reason);
  const suffix =
    persisted === false
      ? 'session only — nothing is written to disk'
      : // For the fallback the reason is always `OK`, which says nothing. What the
        // reader wants is why the OS store is out of the picture.
        ((isFileBackend(backend) ? asString(detail) : undefined) ?? reasonLabel);
  return suffix ? `${backendLabel} (${suffix})` : backendLabel;
}

const CREDENTIAL_SOURCE_LABELS: Record<string, string> = {
  'personal-token': 'personal login',
  'config-api-key': 'project API key',
  'explicit-api-key': 'API key passed to this command',
};

function formatLogin(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const identity = describeIdentity(result.identity as AuthIdentity);
  lines.push(identity ? `Signed in as ${identity}` : 'Signed in');

  const apiUrl = asString(result.apiUrl);
  if (apiUrl) lines.push(`Server: ${apiUrl}`);

  const store = describeStore(result.storeBackend, result.storeReason, result.persisted, result.storeDetail);
  if (store) lines.push(`Stored in: ${store}`);
  if (isFileBackend(result.storeBackend)) lines.push(FILE_BACKEND_WARNING);

  const configPath = asString(result.configPath);
  // configPath is null when the project was not switched over, which the warning
  // below explains — so only claim the switch when it actually happened.
  if (configPath) lines.push(`Project: ${configPath} (switched to personal login)`);

  if (result.deviceAuth === true) lines.push('Flow: device code (--device-auth)');
  const deviceAuthDefaultPath = asString(result.deviceAuthDefaultPath);
  if (deviceAuthDefaultPath) {
    lines.push(`Machine default: device-code login saved to ${deviceAuthDefaultPath}`);
  }

  return lines;
}

function formatStatus(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const token = asRecord(result.personalToken);

  const source = asString(result.credentialSource);
  lines.push(`Credential: ${source ? (CREDENTIAL_SOURCE_LABELS[source] ?? source) : 'none usable'}`);

  const identity = describeIdentity(token.identity as AuthIdentity);
  if (identity) lines.push(`Signed in as ${identity}`);

  const apiUrl = asString(result.apiUrl);
  if (apiUrl) lines.push(`Server: ${apiUrl}`);

  const configPath = asString(result.configPath);
  if (configPath) {
    const authMode = asString(result.authMode);
    lines.push(`Project: ${configPath}${authMode === 'personal-token' ? ' (personal login)' : ''}`);
  }

  const store = describeStore(token.storeBackend, token.storeReason, token.persisted, token.storeDetail);
  if (store) lines.push(`Store: ${store}`);
  if (isFileBackend(token.storeBackend)) lines.push(FILE_BACKEND_WARNING);

  const expiresAt = asString(token.expiresAt);
  if (expiresAt) lines.push(`Access token expires: ${expiresAt}`);

  // Without this line there is no way to discover that this machine is on the
  // device flow, nor how to turn it back off.
  const deviceAuthDefault = asRecord(result.deviceAuthDefault);
  if (deviceAuthDefault.enabled === true) {
    lines.push("Login flow: device code is this machine's default");
    const disableHint = asString(deviceAuthDefault.disableHint);
    if (disableHint) lines.push(disableHint);
  }

  // A stored-but-rejected token is the case where "connected" alone misleads.
  if (token.reconnectRequired === true) {
    lines.push("Sign-in required: the stored login was rejected. Run 'agentteams auth login'.");
  }

  return lines;
}

function formatLogout(result: Record<string, unknown>): string[] {
  const lines: string[] = ['Signed out'];

  const apiUrl = asString(result.apiUrl);
  if (apiUrl) lines.push(`Server: ${apiUrl}`);

  lines.push(
    result.revokedOnServer === true
      ? 'Server-side token: revoked'
      : 'Server-side token: still valid — revoke it in the AgentTeams web app',
  );

  const configPath = asString(result.configPath);
  if (configPath) lines.push(`Project: ${configPath} (personal login setting removed)`);
  if (result.fellBackToApiKey === true) {
    lines.push('This project fell back to the API key still in its config.');
  }

  return lines;
}

/**
 * Render an `auth` result as text. Unknown actions fall back to JSON so a new
 * subcommand is never silently reduced to nothing.
 */
export function formatAuthResultText(action: string, result: unknown): string {
  const record = asRecord(result);
  const lines =
    action === 'login'
      ? formatLogin(record)
      : action === 'status'
        ? formatStatus(record)
        : action === 'logout'
          ? formatLogout(record)
          : null;

  if (!lines) return JSON.stringify(result, null, 2);

  // `problem` and `warning` are the reason a user ran the command at all, so they
  // go last where the eye lands.
  const problem = asString(record.problem);
  if (problem) lines.push(`Problem: ${problem}`);
  const warning = asString(record.warning);
  if (warning) lines.push(`Warning: ${warning}`);

  return lines.join('\n');
}
