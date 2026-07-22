import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { sendWorktreeLifecycleEvent } from '../api/worktree.js';
import { getGitRemoteOriginUrl, resolveGitTopLevel, resolveMainCheckoutRoot } from '../utils/git.js';
const readDaemonConfig = () => {
    const fromEnv = process.env.AGENTTEAMS_DAEMON_TOKEN?.trim();
    if (fromEnv)
        return { daemonToken: fromEnv, apiUrl: process.env.AGENTTEAMS_API_URL?.trim() };
    try {
        const parsed = JSON.parse(readFileSync(join(homedir(), '.agentteams', 'daemon.json'), 'utf8'));
        const daemonToken = parsed.daemonToken?.trim();
        return daemonToken ? { daemonToken, apiUrl: parsed.apiUrl?.trim() } : null;
    }
    catch {
        return null;
    }
};
const normalizeApiUrl = (value) => value.replace(/\/+$/u, '');
export const computeWorktreeLocalKey = (worktreePath) => {
    let canonicalPath;
    try {
        canonicalPath = realpathSync(worktreePath);
    }
    catch {
        canonicalPath = resolve(worktreePath);
    }
    return createHash('sha256').update(canonicalPath).digest('hex');
};
export const createDefaultWorktreeEventId = (event) => `orca:${event.toLowerCase()}:${randomUUID()}`;
export const waitForPathRemoval = async (worktreePath, options = {}) => {
    const intervalMs = options.intervalMs ?? 100;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    while (existsSync(worktreePath)) {
        if (Date.now() >= deadline)
            return false;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
    }
    return true;
};
const deliverDeferredDeletedEvent = async () => {
    const encoded = process.env.AGENTTEAMS_DEFERRED_WORKTREE_EVENT;
    if (!encoded)
        throw new Error('Deferred worktree event payload is missing.');
    const deferred = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!(await waitForPathRemoval(deferred.worktreePath))) {
        return { message: 'Worktree removal was not observed; deleted event was not sent.' };
    }
    const daemonConfig = readDaemonConfig();
    if (!daemonConfig)
        throw new Error("Daemon token is missing. Run 'agentrunner init --token <token>' first.");
    const apiUrl = normalizeApiUrl(daemonConfig.apiUrl || process.env.AGENTTEAMS_API_URL || 'https://api.agentteams.run');
    return sendWorktreeLifecycleEvent(apiUrl, { 'x-daemon-token': daemonConfig.daemonToken }, deferred.event);
};
const scheduleDeletedEventAfterRemoval = (worktreePath, stableCwd, event) => {
    const encoded = Buffer.from(JSON.stringify({ worktreePath, event })).toString('base64url');
    const child = spawn(process.execPath, [process.argv[1], 'worktree', 'deliver-deleted'], {
        cwd: stableCwd,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, AGENTTEAMS_DEFERRED_WORKTREE_EVENT: encoded },
    });
    child.unref();
};
export async function executeWorktreeCommand(action, options) {
    if (action === 'deliver-deleted')
        return deliverDeferredDeletedEvent();
    if (action !== 'notify-created' && action !== 'notify-deleted') {
        throw new Error(`Unknown action: ${action}`);
    }
    const cwd = typeof options.cwd === 'string' ? resolve(options.cwd) : process.cwd();
    const topLevel = resolveGitTopLevel(cwd);
    if (!topLevel)
        throw new Error('Current directory is not a Git worktree.');
    const commonRoot = resolveMainCheckoutRoot(topLevel) ?? topLevel;
    const remoteUrl = getGitRemoteOriginUrl();
    const localKey = (typeof options.localKey === 'string' && options.localKey.trim()) || computeWorktreeLocalKey(topLevel);
    const branch = getGitValue(['branch', '--show-current'], cwd);
    const headSha = getGitValue(['rev-parse', 'HEAD'], cwd);
    const event = action === 'notify-created' ? 'CREATED' : 'DELETED';
    const eventId = (typeof options.eventId === 'string' && options.eventId.trim()) || createDefaultWorktreeEventId(event);
    const payload = {
        event,
        eventId: eventId.slice(0, 128),
        occurredAt: (typeof options.occurredAt === 'string' && options.occurredAt.trim()) || new Date().toISOString(),
        ...(typeof options.repositoryId === 'string' && options.repositoryId.trim()
            ? { repositoryId: options.repositoryId.trim() }
            : remoteUrl
                ? { remoteUrl }
                : {}),
        localKey,
        branch: branch || null,
        headSha: headSha || null,
        displayName: branch || null,
    };
    const daemonConfig = readDaemonConfig();
    if (!daemonConfig) {
        throw new Error("Daemon token is missing. Run 'agentrunner init --token <token>' first.");
    }
    const apiUrl = normalizeApiUrl(daemonConfig.apiUrl || process.env.AGENTTEAMS_API_URL || 'https://api.agentteams.run');
    if (event === 'DELETED' && options.afterRemoval === true) {
        scheduleDeletedEventAfterRemoval(topLevel, commonRoot, payload);
        return { message: 'Worktree deleted event scheduled for delivery after removal.' };
    }
    const result = await sendWorktreeLifecycleEvent(apiUrl, { 'x-daemon-token': daemonConfig.daemonToken }, payload);
    return { message: `Worktree ${event.toLowerCase()} event sent.`, ...(result ?? {}) };
}
function getGitValue(args, cwd) {
    try {
        return (String(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })).trim() || undefined);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=worktree.js.map