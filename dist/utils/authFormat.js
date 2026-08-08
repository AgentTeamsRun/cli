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
const asString = (value) => typeof value === 'string' && value.trim().length > 0 ? value : undefined;
const asRecord = (value) => value && typeof value === 'object' ? value : {};
/** `nickname <email>`, falling back to whichever half is present. */
function describeIdentity(identity) {
    const record = asRecord(identity);
    const email = asString(record.email);
    const nickname = asString(record.nickname);
    if (email && nickname)
        return `${nickname} <${email}>`;
    return email ?? nickname ?? asString(record.memberId);
}
/** "macOS keychain (OK)" — the backend plus why it can or cannot persist. */
function describeStore(backend, reason, persisted) {
    const labels = {
        'macos-keychain': 'macOS keychain',
        'windows-credential-manager': 'Windows Credential Manager',
        libsecret: 'libsecret (Secret Service)',
        none: 'none',
    };
    const backendLabel = labels[String(backend)] ?? asString(backend);
    if (!backendLabel)
        return undefined;
    const reasonLabel = asString(reason);
    const suffix = persisted === false ? 'session only — nothing is written to disk' : reasonLabel;
    return suffix ? `${backendLabel} (${suffix})` : backendLabel;
}
const CREDENTIAL_SOURCE_LABELS = {
    'personal-token': 'personal login',
    'config-api-key': 'project API key',
    'explicit-api-key': 'API key passed to this command',
};
function formatLogin(result) {
    const lines = [];
    const identity = describeIdentity(result.identity);
    lines.push(identity ? `Signed in as ${identity}` : 'Signed in');
    const apiUrl = asString(result.apiUrl);
    if (apiUrl)
        lines.push(`Server: ${apiUrl}`);
    const store = describeStore(result.storeBackend, result.storeReason, result.persisted);
    if (store)
        lines.push(`Stored in: ${store}`);
    const configPath = asString(result.configPath);
    // configPath is null when the project was not switched over, which the warning
    // below explains — so only claim the switch when it actually happened.
    if (configPath)
        lines.push(`Project: ${configPath} (switched to personal login)`);
    return lines;
}
function formatStatus(result) {
    const lines = [];
    const token = asRecord(result.personalToken);
    const source = asString(result.credentialSource);
    lines.push(`Credential: ${source ? (CREDENTIAL_SOURCE_LABELS[source] ?? source) : 'none usable'}`);
    const identity = describeIdentity(token.identity);
    if (identity)
        lines.push(`Signed in as ${identity}`);
    const apiUrl = asString(result.apiUrl);
    if (apiUrl)
        lines.push(`Server: ${apiUrl}`);
    const configPath = asString(result.configPath);
    if (configPath) {
        const authMode = asString(result.authMode);
        lines.push(`Project: ${configPath}${authMode === 'personal-token' ? ' (personal login)' : ''}`);
    }
    const store = describeStore(token.storeBackend, token.storeReason, token.persisted);
    if (store)
        lines.push(`Store: ${store}`);
    const expiresAt = asString(token.expiresAt);
    if (expiresAt)
        lines.push(`Access token expires: ${expiresAt}`);
    // A stored-but-rejected token is the case where "connected" alone misleads.
    if (token.reconnectRequired === true) {
        lines.push("Sign-in required: the stored login was rejected. Run 'agentteams auth login'.");
    }
    return lines;
}
function formatLogout(result) {
    const lines = ['Signed out'];
    const apiUrl = asString(result.apiUrl);
    if (apiUrl)
        lines.push(`Server: ${apiUrl}`);
    lines.push(result.revokedOnServer === true
        ? 'Server-side token: revoked'
        : 'Server-side token: still valid — revoke it in the AgentTeams web app');
    const configPath = asString(result.configPath);
    if (configPath)
        lines.push(`Project: ${configPath} (personal login setting removed)`);
    if (result.fellBackToApiKey === true) {
        lines.push('This project fell back to the API key still in its config.');
    }
    return lines;
}
/**
 * Render an `auth` result as text. Unknown actions fall back to JSON so a new
 * subcommand is never silently reduced to nothing.
 */
export function formatAuthResultText(action, result) {
    const record = asRecord(result);
    const lines = action === 'login'
        ? formatLogin(record)
        : action === 'status'
            ? formatStatus(record)
            : action === 'logout'
                ? formatLogout(record)
                : null;
    if (!lines)
        return JSON.stringify(result, null, 2);
    // `problem` and `warning` are the reason a user ran the command at all, so they
    // go last where the eye lands.
    const problem = asString(record.problem);
    if (problem)
        lines.push(`Problem: ${problem}`);
    const warning = asString(record.warning);
    if (warning)
        lines.push(`Warning: ${warning}`);
    return lines.join('\n');
}
//# sourceMappingURL=authFormat.js.map