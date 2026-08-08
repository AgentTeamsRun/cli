import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { multiselect, isCancel, cancel } from '@clack/prompts';
import httpClient from '../utils/httpClient.js';
import open from 'open';
import { createAuthState, createPkcePair, isUnifiedSetupMetadataMissing, SETUP_LEGACY_AGENT_KEY_HINT, SETUP_METADATA_MISSING_HINT, startLocalAuthServer, startUnifiedSetupServer, } from '../utils/authServer.js';
import { DEFAULT_API_URL, findProjectConfig, loadProjectConfig, loadConfigWithCredential, saveConfig, saveLegacyApiKeyConfig, } from '../utils/config.js';
import { getPersonalTokenClient } from '../auth/personalTokenClient.js';
import { createSpinner, withSpinner } from '../utils/spinner.js';
import { withCommandContext } from '../utils/commandContext.js';
import { conventionDownload, conventionStatus, CONVENTION_MANIFEST_FILE, } from './convention.js';
import { executeDoctorCommand } from './doctor.js';
import { resolveGitTopLevel, shouldInstallWorktreeHook } from '../utils/git.js';
import { canonicalizePath } from '../utils/path.js';
import { readOrCreateMachineId } from '../utils/machineId.js';
import { buildAuthHeaders } from '../utils/apiContext.js';
import { AGENT_ENTRY_POINT_FILES, detectAgentEntryPointFiles, parseAgentFilesOption, } from '../utils/agentEntryPoints.js';
import { bootstrapLinkedWorktree, resolveLinkedWorktreeSource } from './initWorktree.js';
import { DEFAULT_CONVENTION_REFERENCE, ensurePostCheckoutHook, } from '../utils/conventionLink.js';
export { bootstrapLinkedWorktree } from './initWorktree.js';
const AUTH_BASE_URL = process.env.AGENTTEAMS_WEB_URL || 'https://agentteams.run';
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const CONVENTION_FILE = 'convention.md';
const AUTH_PATH_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs9s9+n0C8Z099LrOTlKB
83c2WluO/TxZFxJQ07XgfKJ2RG/8K2kvCwVKeSgzzBP/hmY2qWAgAOrXIoSHNYGt
EPX6qkbWQmE27pxmLk6dWdCdUJcEs3r7lfLlJU7BPCFmH6GozHDX7jR9VeGIDdxu
c2cX4cEfs01xffT2EK7lfNrYTmwlnB5WMEr0jX+DUfjb/7HfC6Fg8J6cacxdjvqy
kmeQx6wGzG3OtYytKoOgbCY7wuRFOFoCphNPbaRzofnob/QM3hfLIyvgPDq6f6qG
HVz0XnMxh/7GdXCHHBTasxC965LHgOcJRhMJ51vadetmX4Xv8yoo5zkAmvb37/yo
JwIDAQAB
-----END PUBLIC KEY-----`;
function isSshEnvironment() {
    return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}
function encodeBase64Url(value) {
    return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function encryptAuthPath(authPath) {
    const sessionKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(authPath, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedSessionKey = publicEncrypt({
        key: AUTH_PATH_PUBLIC_KEY_PEM,
        oaepHash: 'sha256',
        padding: constants.RSA_PKCS1_OAEP_PADDING,
    }, sessionKey);
    const payload = {
        ek: encodeBase64Url(encryptedSessionKey),
        iv: encodeBase64Url(iv),
        tag: encodeBase64Url(authTag),
        ct: encodeBase64Url(ciphertext),
    };
    return `v1.${encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
}
export function detectOsType() {
    if (process.platform === 'darwin') {
        return 'MACOS';
    }
    if (process.platform === 'linux') {
        return 'LINUX';
    }
    if (process.platform === 'win32') {
        return 'WINDOWS';
    }
    return undefined;
}
export function buildAuthorizeUrl(input) {
    const params = new URLSearchParams({
        port: String(input.port),
        projectName: input.projectName,
    });
    if (input.authPathEnc && input.authPathEnc.length > 0) {
        params.set('ap', input.authPathEnc);
    }
    if (input.osType && input.osType.length > 0) {
        params.set('ot', input.osType);
    }
    // Machine identity, shared with the runner installed on this machine. It is not a secret and is
    // only used to bind the agent to the runner that can actually reach this workspace.
    if (input.machineId && input.machineId.length > 0) {
        params.set('mid', input.machineId);
    }
    // The web page echoes this back through the callback; without it the local
    // server cannot tell this login apart from one someone else started.
    if (input.state && input.state.length > 0) {
        params.set('state', input.state);
    }
    if (input.codeChallenge && input.codeChallenge.length > 0) {
        params.set('code_challenge', input.codeChallenge);
        params.set('flow', 'setup');
    }
    return `${AUTH_BASE_URL}/cli/authorize?${params.toString()}`;
}
function printAuthorizeUrl(url) {
    const displayUrl = (() => {
        try {
            const parsed = new URL(url);
            if (parsed.searchParams.has('ap')) {
                parsed.searchParams.set('ap', '[secure]');
            }
            return parsed.toString();
        }
        catch {
            return url;
        }
    })();
    console.log('🚀 Complete a free login in 1 second to download the template:');
    console.log(displayUrl);
}
async function tryOpenBrowser(url) {
    printAuthorizeUrl(url);
    if (isSshEnvironment()) {
        return;
    }
    try {
        await open(url);
    }
    catch {
        // Already printed
    }
}
function normalizeApiUrl(apiUrl) {
    return apiUrl.replace(/\/+$/, '');
}
/**
 * Where the CLI talks to is the CLI's own decision. It used to come from the
 * browser callback payload, so anything that reached the local callback port
 * could redirect every later request — including the convention download whose
 * content becomes always-on agent rules.
 */
function resolveApiUrl() {
    return normalizeApiUrl(process.env.AGENTTEAMS_API_URL || DEFAULT_API_URL);
}
/**
 * What actually lands in `.agentteams/config.json`.
 *
 * The default document is deliberately secret-free. The callback's agent key is
 * used only in-process to fetch conventions and is revoked before init exits.
 * `apiUrl` is always explicit so the persisted schema is stable across default
 * and custom deployments.
 *
 * `authMode` is not decoration: it is the only on-disk marker that this project
 * *chose* the personal login. `planCredential` keys `optedIn` off it, and that
 * flag is what turns "config exists, credential missing" into "run `agentteams
 * auth login`" instead of the misleading "run `agentteams init` first" — the
 * exact state after `auth logout`, a fresh clone, or a wiped OS keychain.
 */
function toConfig(authResult, apiUrl) {
    return {
        teamId: authResult.teamId,
        projectId: authResult.projectId,
        apiUrl,
        authMode: 'personal-token',
    };
}
/** Preserve the original config shape only for the explicit compatibility flag. */
function toLegacyApiKeyConfig(authResult, apiUrl) {
    const config = {
        teamId: authResult.teamId,
        projectId: authResult.projectId,
        apiKey: authResult.apiKey,
    };
    if (apiUrl !== DEFAULT_API_URL) {
        config.apiUrl = apiUrl;
    }
    return config;
}
async function fetchConventionTemplate(authResult, apiUrl) {
    const response = await httpClient.get(`${apiUrl}/api/projects/${authResult.projectId}/agent-configs/${authResult.configId}/convention`, {
        headers: {
            ...buildAuthHeaders(authResult.apiKey),
            'Content-Type': 'application/json',
        },
    });
    const content = response.data?.data?.content;
    if (typeof content !== 'string') {
        throw new Error('Invalid convention template response from server.');
    }
    return content;
}
/**
 * Which entry point files this run may write.
 *
 * The order is deliberate: an explicit `--agent-files` wins over everything, a
 * TTY still gets the multiselect (now seeded with what was detected instead of
 * everything), and a non-TTY run gets the detection result alone. The old
 * non-TTY branch returned the full catalog, so every automated re-run wrote all
 * four files — and an `-example` sibling for each one that already existed.
 */
/**
 * `allowPrompt` is false on the configured-project repair pass: that path exists
 * to make a re-run of `agentteams init` actually re-apply the local adapters,
 * and a fast path that stops to ask a question is no longer a fast path.
 * Detection still runs there, so a missing entry point is created and an
 * existing one is reported as untouched.
 */
async function resolveAgentFileSelection(cwd, explicitFiles, options) {
    if (explicitFiles) {
        return explicitFiles;
    }
    const detected = detectAgentEntryPointFiles(cwd);
    if (options?.allowPrompt === false || !process.stdin.isTTY) {
        return detected;
    }
    const selected = await multiselect({
        message: 'Select agent entry point files to create:',
        options: AGENT_ENTRY_POINT_FILES.map((f) => ({
            value: f.value,
            label: f.label,
            hint: f.hint,
        })),
        initialValues: detected,
        required: false,
    });
    if (isCancel(selected)) {
        cancel('Init cancelled.');
        process.exit(0);
    }
    return selected;
}
function ensureGitignore(cwd) {
    const gitignorePath = join(cwd, '.gitignore');
    const entry = '.agentteams';
    const block = `# AgentTeams local config\n${entry}\n`;
    if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, 'utf-8');
        const lines = content.split('\n').map((l) => l.trim());
        if (lines.includes(entry)) {
            return;
        }
        const separator = content.endsWith('\n') ? '\n' : '\n\n';
        appendFileSync(gitignorePath, `${separator}${block}`, 'utf-8');
        console.log(`✅ Added ${entry} to .gitignore`);
    }
    else {
        writeFileSync(gitignorePath, `${block}`, 'utf-8');
        console.log(`✅ Created .gitignore with ${entry}`);
    }
}
function ensureGeminiIgnore(cwd) {
    const geminiIgnorePath = join(cwd, '.geminiignore');
    const entry = '!.agentteams';
    if (existsSync(geminiIgnorePath)) {
        const content = readFileSync(geminiIgnorePath, 'utf-8');
        const lines = content.split('\n').map((l) => l.trim());
        if (lines.includes(entry)) {
            return;
        }
        const separator = content.endsWith('\n') ? '\n' : '\n\n';
        appendFileSync(geminiIgnorePath, `${separator}# Allow AgentTeams convention files\n${entry}\n`, 'utf-8');
    }
    else {
        writeFileSync(geminiIgnorePath, `# Allow AgentTeams convention files\n${entry}\n`, 'utf-8');
    }
}
/**
 * Write the selected entry points, never over an existing file.
 *
 * An occupied path is reported as `skipped` rather than answered with a
 * `<name>-example` sibling: the example write is unconditional, so a repeated
 * init kept re-creating files nobody merged. `--agent-files-example` restores
 * the old behavior for the case it was built for — a first-time setup on a repo
 * that already has its own CLAUDE.md.
 *
 * Each file is written under its own try/catch and failures come back alongside
 * the entries instead of as an exception. Letting one unwritable path throw out
 * of the loop discarded the record of every file already on disk, so the caller
 * reported `agentFiles: []` for a run that had in fact created some of them —
 * the JSON contract and the human output both disagreeing with the filesystem.
 */
function generateAgentEntryPointFiles(cwd, selectedFiles, options) {
    const entries = [];
    const failures = [];
    for (const relativePath of selectedFiles) {
        const fullPath = join(cwd, relativePath);
        try {
            if (existsSync(fullPath)) {
                if (!options.createExample) {
                    entries.push({ relativePath, type: 'skipped' });
                    continue;
                }
                const ext = relativePath.includes('.') ? `.${relativePath.split('.').pop()}` : '';
                const base = ext ? relativePath.slice(0, -ext.length) : relativePath;
                const exampleRelativePath = `${base}-example${ext}`;
                const exampleFullPath = join(cwd, exampleRelativePath);
                const exampleDir = dirname(exampleFullPath);
                if (!existsSync(exampleDir)) {
                    mkdirSync(exampleDir, { recursive: true });
                }
                writeFileSync(exampleFullPath, DEFAULT_CONVENTION_REFERENCE, 'utf-8');
                entries.push({ relativePath: exampleRelativePath, type: 'example' });
                continue;
            }
            const dir = dirname(fullPath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(fullPath, DEFAULT_CONVENTION_REFERENCE, 'utf-8');
            entries.push({ relativePath, type: 'created' });
        }
        catch (error) {
            failures.push({ relativePath, message: toErrorMessage(error) });
        }
    }
    return { entries, failures };
}
function toComparablePath(path) {
    try {
        return canonicalizePath(path);
    }
    catch {
        return path;
    }
}
/**
 * Does the discovered config actually belong to the directory init was asked to
 * initialize?
 *
 * `findProjectConfig` walks ancestors — outside a repository all the way to the
 * filesystem root, which includes the global `~/.agentteams/config.json` that
 * `mergeConfigSources` reads as a fallback. The new-project path, in contrast,
 * always writes to `join(cwd, CONFIG_DIR, CONFIG_FILE)`. Reusing an ancestor's
 * binding as a "configured project" would therefore make `init` in a fresh
 * folder a silent no-op that reports someone else's project.
 */
function ownsDiscoveredConfig(resolvedCwd, configPath, userHomeDir) {
    const configRoot = toComparablePath(dirname(dirname(configPath)));
    // The global config is a fallback for commands, never a project binding.
    if (configRoot === toComparablePath(userHomeDir))
        return false;
    const owners = new Set([toComparablePath(resolvedCwd)]);
    const repositoryRoot = resolveGitTopLevel(resolvedCwd);
    if (repositoryRoot)
        owners.add(toComparablePath(repositoryRoot));
    return owners.has(configRoot);
}
/**
 * Classify init before it opens a browser or materializes any local adapters.
 *
 * This resolver is intentionally read-only: the linked-worktree branch calls
 * `bootstrapLinkedWorktree` and the configured-project branch resolves its
 * credential only after classification, so a classification never touches a
 * keychain, a token, or the filesystem.
 *
 * `userHomeDir` is injectable for the same reason as in
 * `getConfigurationNotFoundMessage`: `os.homedir()` does not follow a test's
 * `process.env.HOME`, so the global-config rule would be untestable otherwise.
 */
export function detectInitExecutionContext(cwd, explicitAuthMode, userHomeDir = homedir()) {
    const resolvedCwd = resolve(cwd);
    const configPath = findProjectConfig(resolvedCwd);
    const config = configPath ? loadProjectConfig(resolvedCwd) : null;
    if (resolveLinkedWorktreeSource(resolvedCwd)) {
        return { kind: 'linked-worktree', configPath, config };
    }
    const hasProjectBinding = typeof config?.teamId === 'string' &&
        config.teamId.length > 0 &&
        typeof config.projectId === 'string' &&
        config.projectId.length > 0;
    // An explicit --auth choice means the caller intends to reconnect instead of
    // validating the existing binding through the configured-project fast path.
    const kind = configPath && hasProjectBinding && ownsDiscoveredConfig(resolvedCwd, configPath, userHomeDir) && !explicitAuthMode
        ? 'configured-project'
        : 'new-project';
    return { kind, configPath, config };
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function executeInitCommand(options) {
    return withCommandContext('init', () => executeInitCommandWithContext(options));
}
/**
 * Wait for the browser round trip without losing Ctrl+C.
 *
 * Shared by both auth paths so the cancel handling — SIGINT plus the raw-mode
 * ^C read a spinner would otherwise swallow — exists exactly once.
 */
async function waitForBrowserCallback(authContext, spinner) {
    let restored = false;
    // Runs on every exit — success, timeout, or server error. Leaving it on the
    // success path only meant a failed init handed the shell back in raw mode,
    // with input no longer echoing until the user typed `reset`.
    const restoreTerminal = () => {
        if (restored) {
            return;
        }
        restored = true;
        process.removeListener('SIGINT', onSigint);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onKeypress);
        }
    };
    function onSigint() {
        restoreTerminal();
        spinner?.fail('Init cancelled.');
        if (authContext.server.listening) {
            authContext.server.close();
        }
        process.exit(0);
    }
    function onKeypress(key) {
        if (key[0] === 0x03) {
            onSigint();
        }
    }
    process.on('SIGINT', onSigint);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onKeypress);
    }
    try {
        return await authContext.waitForCallback();
    }
    finally {
        restoreTerminal();
    }
}
/**
 * The default path: one browser screen, no agent API key, one convention write.
 *
 * The browser returns an authorization code plus the connection identifiers, so
 * the second round trip that used to run here (`performPersonalTokenLogin`) is
 * gone, and with it the `key_` that only ever existed to read the convention
 * template once. `agentteams auth login` still owns that helper for the
 * project-less login.
 */
async function runUnifiedSetup(context) {
    const pkce = createPkcePair();
    let server;
    try {
        server = await startUnifiedSetupServer({ state: createAuthState() });
    }
    catch (error) {
        throw new Error(`Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`);
    }
    const authUrl = buildAuthorizeUrl({
        port: server.port,
        projectName: context.projectName,
        authPathEnc: context.authPathEnc,
        osType: detectOsType(),
        state: server.state,
        machineId: readOrCreateMachineId() ?? undefined,
        codeChallenge: pkce.challenge,
    });
    await tryOpenBrowser(authUrl);
    const authSpinner = createSpinner('Waiting for authentication... (Ctrl+C to cancel)');
    try {
        const callback = await waitForBrowserCallback(server, authSpinner);
        authSpinner?.succeed();
        if (isUnifiedSetupMetadataMissing(callback)) {
            throw new Error(callback.legacyAgentKeyIssued ? SETUP_LEGACY_AGENT_KEY_HINT : SETUP_METADATA_MISSING_HINT);
        }
        const setup = callback;
        // Storing the credential comes before `saveConfig` on purpose: a login that
        // cannot be kept throws here, so init stops rather than leaving a project
        // configured for a credential nothing can find.
        const client = getPersonalTokenClient(context.apiUrl);
        const session = await client.exchangeAuthorizationCode({
            code: setup.code,
            codeVerifier: pkce.verifier,
            // Must match the redirect the web registered the code against.
            redirectUri: `http://localhost:${server.port}/callback`,
        });
        saveConfig(context.configPath, toConfig(setup, context.apiUrl));
        // The identifiers are passed explicitly rather than re-read from disk: this
        // command may run against a `cwd` that is not `process.cwd()`, and the
        // config resolver only ever looks at the latter.
        const runtimeConfig = await loadConfigWithCredential({
            teamId: setup.teamId,
            projectId: setup.projectId,
            apiUrl: context.apiUrl,
            authMode: 'personal-token',
        });
        // Falling back to a bare `conventionDownload()` here would undo the sentence
        // above: with no config passed it re-resolves the project from
        // `process.cwd()`, so an `init --cwd` (a worktree bootstrap included) would
        // quietly pull conventions for whichever project the shell happens to sit
        // in. Fail instead — this only happens if credential resolution regressed.
        if (!runtimeConfig) {
            throw new Error('Signed in, but the stored credential could not be read back, so the convention template was not downloaded. ' +
                'Check `agentteams auth status`, then run `agentteams convention download` in this folder.');
        }
        // The convention template is now written by `conventionDownload` alone —
        // exactly one write of `.agentteams/convention.md` per init — using the
        // agent this setup actually created instead of "whichever config is first".
        await conventionDownload({
            cwd: context.cwd,
            agentConfigId: setup.configId,
            config: runtimeConfig,
        });
        return {
            authUrl,
            teamId: setup.teamId,
            projectId: setup.projectId,
            agentName: setup.agentName,
            seedPlanId: setup.seedPlanId ?? null,
            personalLogin: {
                email: session.identity.email,
                nickname: session.identity.nickname,
                persisted: client.state().persisted,
            },
        };
    }
    catch (error) {
        authSpinner?.fail();
        if (server.server.listening) {
            server.server.close();
        }
        throw error;
    }
}
/**
 * The explicit `--auth api-key` compatibility path, unchanged.
 *
 * It keeps the legacy authorize URL (no `flow=setup`, no `code_challenge`), the
 * legacy callback payload with its `key_`, and the direct convention write. CI
 * users depend on this shape, so it is isolated from the default path rather
 * than sharing a branch with it.
 */
async function runLegacyApiKeySetup(context) {
    let authContext;
    try {
        authContext = await startLocalAuthServer({ state: createAuthState() });
    }
    catch (error) {
        throw new Error(`Failed to start local OAuth server: ${error instanceof Error ? error.message : String(error)}`);
    }
    const authUrl = buildAuthorizeUrl({
        port: authContext.port,
        projectName: context.projectName,
        authPathEnc: context.authPathEnc,
        osType: detectOsType(),
        state: authContext.state,
        machineId: readOrCreateMachineId() ?? undefined,
    });
    await tryOpenBrowser(authUrl);
    const authSpinner = createSpinner('Waiting for authentication... (Ctrl+C to cancel)');
    try {
        const authResult = await waitForBrowserCallback(authContext, authSpinner);
        authSpinner?.succeed();
        const runtimeConfig = {
            teamId: authResult.teamId,
            projectId: authResult.projectId,
            apiKey: authResult.apiKey,
            apiUrl: context.apiUrl,
        };
        const conventionContent = await withSpinner('Fetching convention template...', () => fetchConventionTemplate(authResult, context.apiUrl));
        saveLegacyApiKeyConfig(context.configPath, toLegacyApiKeyConfig(authResult, context.apiUrl));
        writeFileSync(context.conventionPath, conventionContent, 'utf-8');
        await conventionDownload({ cwd: context.cwd, config: runtimeConfig });
        return {
            authUrl,
            teamId: authResult.teamId,
            projectId: authResult.projectId,
            agentName: authResult.agentName,
            seedPlanId: authResult.seedPlanId ?? null,
        };
    }
    catch (error) {
        authSpinner?.fail();
        if (authContext.server.listening) {
            authContext.server.close();
        }
        throw error;
    }
}
async function runConfiguredProjectInit(cwd, executionContext, adapterOptions) {
    const configPath = executionContext.configPath;
    const projectConfig = executionContext.config;
    if (!configPath || !projectConfig) {
        throw new Error('The configured project could not be read. Run `agentteams init --auth personal-token` to relink it.');
    }
    // Only the identifiers are forwarded as overrides. Handing the whole config
    // document to `loadConfigWithCredential` would put it above the environment in
    // `mergeConfigSources` (global → project → env → options), so AGENTTEAMS_*
    // would be ignored on this path alone, and a leftover legacy `apiKey` would be
    // read as an *explicit* key — skipping the migration warning and the refresh
    // slot. `apiUrl` follows the same env-first rule as `resolveApiUrl()`.
    const runtimeConfig = await loadConfigWithCredential({
        teamId: projectConfig.teamId,
        projectId: projectConfig.projectId,
        apiUrl: normalizeApiUrl(process.env.AGENTTEAMS_API_URL || projectConfig.apiUrl || DEFAULT_API_URL),
        // `loadConfigWithCredential` normally discovers the project from
        // `process.cwd()`, but init may repair an explicit `options.cwd`. An empty
        // override is intentional: it prevents a legacy key from an unrelated
        // ambient project from becoming this binding's fallback credential.
        apiKey: process.env.AGENTTEAMS_API_KEY || projectConfig.apiKey || '',
        ...(projectConfig.authMode ? { authMode: projectConfig.authMode } : {}),
    });
    if (!runtimeConfig) {
        throw new Error("The existing project binding has no usable credential. Run 'agentteams auth login'.");
    }
    // `checkConventionFreshness` reports "no changes" when the download manifest is
    // absent, which is exactly the state of a project that has never synced. Left
    // alone it would report READY while `.agentteams/convention.md` and
    // `.agentteams/platform/*` — the rules every runner loads as always_on — are
    // missing, so init treats that state as "sync required" instead.
    const conventionDir = dirname(configPath);
    const conventionsNeverSynced = !existsSync(join(conventionDir, CONVENTION_MANIFEST_FILE)) || !existsSync(join(conventionDir, CONVENTION_FILE));
    let freshness;
    let conventionError;
    let conventionsUpdated = false;
    try {
        freshness = await conventionStatus({ cwd, config: runtimeConfig });
        if (freshness.conventionUpdateAvailable || conventionsNeverSynced) {
            await conventionDownload({ cwd, config: runtimeConfig });
            conventionsUpdated = true;
        }
    }
    catch (error) {
        conventionError = toErrorMessage(error);
    }
    // The same adapters the new-project path runs. Without them a re-run of
    // `agentteams init` — which is exactly what every adapter retry command tells
    // the user to do — verified the binding and changed nothing else.
    const adapterPass = await runLocalAdapterPass(cwd, adapterOptions);
    const doctor = await executeDoctorCommand({ cwd, installWorktreeHook: adapterOptions.installWorktreeHook });
    const configuredAuthMode = runtimeConfig.credentialSource === 'personal-token' ? 'personal-token' : 'api-key';
    const readiness = buildConfiguredProjectReadiness(conventionError, doctor, adapterPass.adapters);
    return {
        success: true,
        mode: 'configured-project',
        configPath,
        conventionPath: join(dirname(configPath), CONVENTION_FILE),
        teamId: runtimeConfig.teamId,
        projectId: runtimeConfig.projectId,
        authMode: configuredAuthMode,
        credentialSource: runtimeConfig.credentialSource,
        conventionsUpdated,
        ...(freshness ? { conventionStatus: freshness } : {}),
        ...(conventionError ? { conventionError } : {}),
        doctor,
        readiness,
        agentFiles: adapterPass.agentFiles,
        localAdapters: adapterPass.adapters,
        ...(adapterPass.postCheckoutHook ? { postCheckoutHook: adapterPass.postCheckoutHook } : {}),
    };
}
/**
 * Roll the doctor verdict *and* the local adapter outcomes into one
 * `local-adapters` step.
 *
 * Both sources matter: the doctor owns the layout-level diagnosis (member repo
 * links, config permissions) while the adapters own the files this command
 * writes, and a step that reported only one of them would call the stage READY
 * while the other was degraded.
 */
function buildConfiguredProjectReadiness(conventionError, doctor, adapters) {
    const conventionStep = conventionError
        ? {
            stage: 'convention-sync',
            status: 'DEGRADED',
            issues: [{ code: 'convention-sync-failed', message: conventionError }],
            retryCommand: 'agentteams convention download',
        }
        : { stage: 'convention-sync', status: 'READY', issues: [] };
    const degradedAdapters = adapters.filter((adapter) => adapter.status === 'DEGRADED');
    const doctorDegraded = doctor.status === 'DEGRADED';
    // A NOT_APPLICABLE doctor still contributes its reason: `printReadiness` shows
    // issues at every status, so the note survives even when an adapter succeeded
    // and the step as a whole is READY.
    const issues = [
        ...(doctor.status === 'READY' ? [] : doctor.issues.map(({ code, message }) => ({ code, message }))),
        ...adapters.filter((adapter) => adapter.status !== 'READY').flatMap((adapter) => adapter.issues),
    ];
    const status = doctorDegraded || degradedAdapters.length > 0
        ? 'DEGRADED'
        : adapters.some((adapter) => adapter.status === 'READY')
            ? 'READY'
            : 'SKIPPED';
    const localAdaptersStep = {
        stage: 'local-adapters',
        status,
        issues: status === 'DEGRADED' && issues.length === 0
            ? [{ code: 'doctor-degraded', message: 'Local adapters still need attention.' }]
            : issues,
        ...(status === 'DEGRADED' ? { retryCommand: degradedAdapters[0]?.retryCommand ?? 'agentteams doctor' } : {}),
    };
    return [
        { stage: 'project-binding', status: 'READY', issues: [] },
        { stage: 'credential', status: 'READY', issues: [] },
        conventionStep,
        localAdaptersStep,
    ];
}
/**
 * Roll the per-adapter outcomes into the single `local-adapters` readiness step.
 *
 * A degraded adapter dominates, and `SKIPPED` requires *every* adapter to have
 * skipped — which the always-on `.gitignore` adapter makes unreachable today.
 * The rule is kept honest for the day that adapter becomes conditional, but it
 * is deliberately not what makes a partial skip visible: one green
 * `[READY] local-adapters` line above a hook that was never installed is exactly
 * the mismatch this list exists to prevent, so `printReadiness` prints the
 * issues of every step regardless of its status. Every non-READY adapter
 * contributes its issues, so the reason travels with the line.
 */
function buildNewProjectReadiness(adapters) {
    const degraded = adapters.filter((adapter) => adapter.status === 'DEGRADED');
    const status = degraded.length > 0 ? 'DEGRADED' : adapters.some((adapter) => adapter.status === 'READY') ? 'READY' : 'SKIPPED';
    const localAdaptersStep = {
        stage: 'local-adapters',
        status,
        issues: adapters.filter((adapter) => adapter.status !== 'READY').flatMap((adapter) => adapter.issues),
        ...(degraded.length > 0 ? { retryCommand: degraded[0].retryCommand ?? 'agentteams doctor' } : {}),
    };
    return [
        { stage: 'project-binding', status: 'READY', issues: [] },
        { stage: 'credential', status: 'READY', issues: [] },
        { stage: 'convention-sync', status: 'READY', issues: [] },
        localAdaptersStep,
    ];
}
/**
 * Run one local adapter without letting it fail the init that already
 * succeeded.
 *
 * By the time these run, the credential is in the OS store and the config is on
 * disk. An exception escaping from here used to surface as
 * `Initialization failed: EACCES ...` for a project that was, in fact, fully
 * connected — so every adapter is isolated and reports `DEGRADED` with its own
 * retry command instead. Failures are never swallowed: an adapter that throws
 * always produces an issue.
 */
async function runLocalAdapter(adapter, retryCommand, run) {
    try {
        const outcome = await run();
        return {
            adapter,
            status: outcome.status,
            issues: outcome.issues,
            ...(outcome.status === 'DEGRADED' ? { retryCommand } : {}),
        };
    }
    catch (error) {
        return {
            adapter,
            status: 'DEGRADED',
            issues: [{ code: `${adapter}-failed`, message: toErrorMessage(error) }],
            retryCommand,
        };
    }
}
/**
 * The four local adapters, run identically by both init paths.
 *
 * This is shared rather than duplicated because the adapters advertise retry
 * commands (`agentteams init`, `agentteams init --agent-files <list>`) and those
 * are all `agentteams init`. A project that has just been configured takes the
 * configured-project fast path on the *next* run, so while this pass lived only
 * in the new-project branch every retry command it printed was a no-op: the
 * user was told how to fix a degraded `.gitignore` — the single thing keeping a
 * legacy `--auth api-key` config's agent key out of the repository — by running
 * a command that would not touch `.gitignore` at all.
 */
async function runLocalAdapterPass(cwd, options) {
    const adapters = [];
    adapters.push(
    // `.gitignore` is not conditional and never will be: it is what keeps
    // `.agentteams` — including a legacy config carrying an apiKey — out of the
    // repository.
    await runLocalAdapter('gitignore', 'agentteams init', () => {
        ensureGitignore(cwd);
        return { status: 'READY', issues: [] };
    }));
    let selectedFiles = [];
    let agentFiles = [];
    adapters.push(await runLocalAdapter('agent-entry-points', 'agentteams init --agent-files <list>', async () => {
        selectedFiles = await resolveAgentFileSelection(cwd, options.explicitAgentFiles, {
            allowPrompt: options.allowPrompt,
        });
        if (selectedFiles.length === 0) {
            return {
                status: 'SKIPPED',
                issues: [
                    {
                        code: 'agent-entry-points-not-selected',
                        message: 'No agent entry point file was created. Pass --agent-files (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules/agentteams.mdc) to create them explicitly.',
                    },
                ],
            };
        }
        // Assigned before the failure check so a partially failed write still
        // reports the files that actually reached disk.
        const written = generateAgentEntryPointFiles(cwd, selectedFiles, {
            createExample: options.agentFilesExample,
        });
        agentFiles = written.entries;
        if (written.failures.length > 0) {
            return {
                status: 'DEGRADED',
                issues: written.failures.map((failure) => ({
                    code: 'agent-entry-point-write-failed',
                    message: `${failure.relativePath} could not be written: ${failure.message}`,
                })),
            };
        }
        const skipped = agentFiles.filter((file) => file.type === 'skipped');
        if (skipped.length === agentFiles.length) {
            return {
                status: 'SKIPPED',
                issues: [
                    {
                        code: 'agent-entry-points-exist',
                        message: `Left ${skipped.map((file) => file.relativePath).join(', ')} untouched because the file already exists.`,
                    },
                ],
            };
        }
        return { status: 'READY', issues: [] };
    }));
    adapters.push(await runLocalAdapter('gemini-ignore', 'agentteams init --agent-files GEMINI.md', () => {
        if (!selectedFiles.includes('GEMINI.md')) {
            return {
                status: 'SKIPPED',
                issues: [{ code: 'gemini-ignore-not-selected', message: 'GEMINI.md was not selected.' }],
            };
        }
        ensureGeminiIgnore(cwd);
        return { status: 'READY', issues: [] };
    }));
    // A git-root project shares one hooks directory with all its worktrees, so the
    // managed post-checkout hook lets future `git worktree add` runs bootstrap
    // conventions automatically (via `agentteams init`). It is no longer installed
    // unconditionally: a repository that never uses linked worktrees got its
    // shared `.git/hooks` written for a hook it would never fire. The gate itself
    // lives in `shouldInstallWorktreeHook` so `agentteams doctor` — which this
    // command's own fast path invokes — applies the same rule.
    let postCheckoutHook;
    adapters.push(await runLocalAdapter('post-checkout-hook', 'agentteams doctor', () => {
        if (resolveGitTopLevel(cwd) === null) {
            // Non-git roots (a parent folder grouping member repos) have no
            // git-common dir; doctor owns their per-member hooks instead.
            return {
                status: 'SKIPPED',
                issues: [
                    {
                        code: 'post-checkout-hook-not-a-git-root',
                        message: "Not a git repository root, so no worktree bootstrap hook was installed. Run 'agentteams doctor' to set up member repository hooks.",
                    },
                ],
            };
        }
        if (!shouldInstallWorktreeHook(cwd, { force: options.installWorktreeHook })) {
            return {
                status: 'SKIPPED',
                issues: [
                    {
                        code: 'post-checkout-hook-no-worktrees',
                        message: "This repository has no linked git worktrees, so the worktree bootstrap hook was not installed. Run 'agentteams init --install-worktree-hook' (or 'agentteams doctor --install-worktree-hook') to install it anyway.",
                    },
                ],
            };
        }
        postCheckoutHook = ensurePostCheckoutHook(cwd);
        if (postCheckoutHook.status === 'blocked') {
            // The existing issue code and message, verbatim — the user hook
            // protection in `ensurePostCheckoutHook` is what produced them.
            return {
                status: 'DEGRADED',
                issues: [
                    {
                        code: postCheckoutHook.issue?.code ?? 'post-checkout-hook-blocked',
                        message: postCheckoutHook.issue?.message ?? 'The worktree bootstrap hook could not be installed.',
                    },
                ],
            };
        }
        return { status: 'READY', issues: [] };
    }));
    return { adapters, agentFiles, ...(postCheckoutHook ? { postCheckoutHook } : {}) };
}
async function executeInitCommandWithContext(options) {
    const cwd = resolve(options?.cwd ?? process.cwd());
    // Only an explicit compatibility request goes through the agent-key round trip.
    const authMode = options?.authMode === 'api-key' ? 'api-key' : 'personal-token';
    // Parsed before anything opens a browser: a typo in --agent-files must not be
    // discovered after the user has already signed in.
    const explicitAgentFiles = parseAgentFilesOption(options?.agentFiles);
    const adapterOptions = {
        explicitAgentFiles,
        agentFilesExample: options?.agentFilesExample === true,
        installWorktreeHook: options?.installWorktreeHook === true,
        // Overridden per path below: only a first-time setup may prompt.
        allowPrompt: true,
    };
    const executionContext = detectInitExecutionContext(cwd, options?.authMode);
    if (executionContext.kind === 'linked-worktree') {
        const worktreeResult = bootstrapLinkedWorktree(cwd);
        if (worktreeResult)
            return worktreeResult;
    }
    if (executionContext.kind === 'configured-project') {
        try {
            return await runConfiguredProjectInit(cwd, executionContext, { ...adapterOptions, allowPrompt: false });
        }
        catch (error) {
            throw new Error(`Initialization failed: ${toErrorMessage(error)}`);
        }
    }
    const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
    const conventionPath = join(cwd, CONFIG_DIR, CONVENTION_FILE);
    let authPathEnc;
    try {
        authPathEnc = encryptAuthPath(cwd);
    }
    catch {
        authPathEnc = undefined;
    }
    const context = {
        cwd,
        projectName: basename(cwd),
        apiUrl: resolveApiUrl(),
        configPath,
        conventionPath,
        authPathEnc,
    };
    let setup;
    try {
        setup = authMode === 'api-key' ? await runLegacyApiKeySetup(context) : await runUnifiedSetup(context);
    }
    catch (error) {
        throw new Error(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Everything below runs *after* the credential and the config are stored, so
    // none of it may fail the init. Each adapter reports itself.
    const { adapters: localAdapters, agentFiles, postCheckoutHook } = await runLocalAdapterPass(cwd, adapterOptions);
    const seedPlanId = setup.seedPlanId;
    const seedPlanWebUrl = seedPlanId ? `${AUTH_BASE_URL.replace(/\/+$/, '')}/go?type=plan&id=${seedPlanId}` : null;
    return {
        success: true,
        authUrl: setup.authUrl,
        configPath,
        conventionPath,
        teamId: setup.teamId,
        projectId: setup.projectId,
        agentName: setup.agentName,
        agentFiles,
        seedPlanId,
        seedPlanWebUrl,
        postCheckoutHook,
        authMode,
        readiness: buildNewProjectReadiness(localAdapters),
        localAdapters,
        ...(setup.personalLogin ? { personalLogin: setup.personalLogin } : {}),
    };
}
//# sourceMappingURL=init.js.map