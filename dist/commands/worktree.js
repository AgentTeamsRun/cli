import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
/**
 * worktree 경로의 canonical 형태를 구한다.
 *
 * herdr의 `worktree.removed` 훅은 Git worktree가 삭제된 **뒤에** 실행되므로 경로를 realpath로
 * 확인할 수 없다. 이때 `resolve()`만 쓰면 상위 경로에 심링크가 있는 환경에서 생성 시점과 다른
 * 값이 나와 서버가 같은 worktree로 매칭하지 못한다. 삭제가 worktree 하나로 끝난다는 보장이
 * 없으므로(부모 디렉터리째 지우는 경우가 있다) 부모 한 단계가 아니라 **존재하는 최근접 조상**을
 * realpath한 뒤 사라진 세그먼트를 다시 이어 붙여 생성 시점과 동일한 경로를 복원한다.
 */
const canonicalizeWorktreePath = (worktreePath) => {
    const absolutePath = resolve(worktreePath);
    const missingSegments = [];
    let candidate = absolutePath;
    for (;;) {
        try {
            return join(realpathSync(candidate), ...missingSegments);
        }
        catch {
            const parent = dirname(candidate);
            // 루트까지 올라가도 realpath가 실패하면 더 나은 복원 수단이 없다.
            if (parent === candidate)
                return absolutePath;
            missingSegments.unshift(basename(candidate));
            candidate = parent;
        }
    }
};
export const computeWorktreeLocalKey = (worktreePath) => createHash('sha256').update(canonicalizeWorktreePath(worktreePath)).digest('hex');
export const createDefaultWorktreeEventId = (event, host = 'orca') => `${host}:${event.toLowerCase()}:${randomUUID()}`;
/**
 * 이벤트 이름의 두 표기.
 *
 * `[0]`은 herdr가 `HERDR_PLUGIN_EVENT`로 주입하는 dotted 이름이자 매니페스트가 허용하는 유일한
 * 표기이고, `[1]`은 같은 이벤트의 payload `event` 필드 표기다. 즉 언더스코어 표기는 매니페스트에서
 * 거부되지만 payload에는 그대로 실려 오므로(`captured-contract.json`의 `events.names.rejected`는
 * 매니페스트 기준이다), `HERDR_PLUGIN_EVENT`가 없고 payload만 있는 경로를 위해 함께 허용한다.
 */
const HERDR_EVENT_ALIASES = {
    CREATED: ['worktree.created', 'worktree_created'],
    DELETED: ['worktree.removed', 'worktree_removed'],
};
/**
 * herdr plugin event hook이 주입하는 payload에서 worktree identity를 뽑는다.
 *
 * 훅의 cwd는 플러그인 루트라 Git 조회 기준으로 쓸 수 없고, 삭제 훅 시점에는 worktree 경로가
 * 이미 사라져 있다. 따라서 경로·브랜치·저장소 루트를 모두 이벤트 payload에서 읽는다.
 * 확인 기준: herdr 0.8.0 (`docs/fixtures/herdr-worktree-hooks/captured-contract.json`).
 */
export const parseHerdrWorktreeEvent = (env, expected) => {
    const aliases = HERDR_EVENT_ALIASES[expected];
    const expectedName = aliases[0];
    const raw = env.HERDR_PLUGIN_EVENT_JSON?.trim();
    if (!raw) {
        throw new Error(`HERDR_PLUGIN_EVENT_JSON is missing. Run this command from a herdr '${expectedName}' plugin event hook.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`HERDR_PLUGIN_EVENT_JSON is not valid JSON. Expected a herdr '${expectedName}' event payload.`);
    }
    const receivedName = (typeof env.HERDR_PLUGIN_EVENT === 'string' && env.HERDR_PLUGIN_EVENT.trim()) ||
        (typeof parsed.event === 'string' ? parsed.event : '');
    if (!aliases.includes(receivedName)) {
        throw new Error(`Expected a herdr '${expectedName}' event but received '${receivedName || 'unknown'}'.`);
    }
    const worktreePath = typeof parsed.data?.worktree?.path === 'string' ? parsed.data.worktree.path.trim() : '';
    if (!worktreePath) {
        throw new Error(`herdr '${expectedName}' event payload does not carry a worktree path.`);
    }
    const branch = typeof parsed.data?.worktree?.branch === 'string' ? parsed.data.worktree.branch : null;
    const workspaceWorktree = parsed.data?.workspace?.worktree;
    const repoRootValue = typeof workspaceWorktree?.repo_root === 'string' ? workspaceWorktree.repo_root.trim() : '';
    // repo_root가 없을 때는 repo_key(`<repo>/.git`)의 상위 디렉터리가 메인 체크아웃 루트다.
    const repoKeyValue = typeof workspaceWorktree?.repo_key === 'string' ? workspaceWorktree.repo_key.trim() : '';
    const repoRoot = repoRootValue || (repoKeyValue && basename(repoKeyValue) === '.git' ? dirname(repoKeyValue) : '');
    return { worktreePath, branch, repoRoot: repoRoot || null };
};
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
export const scheduleDeletedEventAfterRemoval = (worktreePath, stableCwd, event, deps = {}) => {
    const encoded = Buffer.from(JSON.stringify({ worktreePath, event })).toString('base64url');
    const currentPlatform = deps.platform ?? process.platform;
    // Windows must not use DETACHED_PROCESS together with CREATE_NO_WINDOW:
    // DETACHED_PROCESS wins and can allocate a visible console. stdio=ignore +
    // unref is sufficient for this short-lived delivery helper to outlive the CLI.
    // windows-hide-guard: child-process-alias spawnFn
    const spawnFn = deps.spawn ?? spawn;
    const child = spawnFn(deps.execPath ?? process.execPath, [deps.entryPath ?? process.argv[1], 'worktree', 'deliver-deleted'], {
        cwd: stableCwd,
        detached: currentPlatform !== 'win32',
        windowsHide: true,
        stdio: 'ignore',
        env: { ...(deps.env ?? process.env), AGENTTEAMS_DEFERRED_WORKTREE_EVENT: encoded },
    });
    child.unref();
};
const defaultGitReader = {
    resolveTopLevel: (cwd) => resolveGitTopLevel(cwd),
    resolveMainRoot: (cwd) => resolveMainCheckoutRoot(cwd),
    readRemoteOriginUrl: (cwd) => getGitRemoteOriginUrl(undefined, cwd),
    readGitValue: (args, cwd) => getGitValue(args, cwd),
};
/** Orca hook 등 worktree 안에서 실행되는 호출자: 현재 디렉터리에서 identity를 계산한다. */
export const resolveCwdIdentity = (cwd, git = defaultGitReader) => {
    const topLevel = git.resolveTopLevel(cwd);
    if (!topLevel)
        throw new Error('Current directory is not a Git worktree.');
    return {
        host: 'orca',
        worktreePath: topLevel,
        stableCwd: git.resolveMainRoot(topLevel) ?? topLevel,
        remoteUrl: git.readRemoteOriginUrl(cwd),
        branch: git.readGitValue(['branch', '--show-current'], cwd) ?? null,
        headSha: git.readGitValue(['rev-parse', 'HEAD'], cwd) ?? null,
    };
};
/** herdr plugin event hook: cwd가 플러그인 루트이므로 identity를 이벤트 payload에서 가져온다. */
export const resolveHerdrIdentity = (herdrEvent, event, git = defaultGitReader) => ({
    host: 'herdr',
    worktreePath: herdrEvent.worktreePath,
    stableCwd: herdrEvent.repoRoot ?? process.cwd(),
    remoteUrl: herdrEvent.repoRoot ? git.readRemoteOriginUrl(herdrEvent.repoRoot) : undefined,
    branch: herdrEvent.branch,
    // 삭제 훅은 worktree가 사라진 뒤 실행되므로 HEAD를 읽을 수 없다.
    headSha: event === 'CREATED' ? (git.readGitValue(['rev-parse', 'HEAD'], herdrEvent.worktreePath) ?? null) : null,
});
/**
 * identity와 커맨드 옵션에서 서버로 보낼 lifecycle payload를 조립한다.
 *
 * 서버는 `repositoryId` 또는 `remoteUrl` 중 하나로만 저장소를 찾는다(둘 다 없으면
 * `WORKTREE_REPOSITORY_NOT_FOUND`). 그 상태로 전송하면 훅 로그에 서버 에러 문자열만 남아
 * 원인(저장소 루트를 읽지 못했다)을 알 수 없으므로 전송 전에 여기서 끊는다.
 */
export const buildWorktreeLifecyclePayload = (event, identity, options) => {
    const repositoryId = typeof options.repositoryId === 'string' && options.repositoryId.trim() ? options.repositoryId.trim() : undefined;
    if (!repositoryId && !identity.remoteUrl) {
        throw new Error(identity.host === 'herdr'
            ? 'Could not identify the repository from the herdr event: the payload carried no repository root, or its origin remote could not be read. Pass --repository-id.'
            : 'Could not identify the repository: the origin remote of the current worktree could not be read. Pass --repository-id.');
    }
    const localKey = (typeof options.localKey === 'string' && options.localKey.trim()) || computeWorktreeLocalKey(identity.worktreePath);
    const eventId = (typeof options.eventId === 'string' && options.eventId.trim()) ||
        createDefaultWorktreeEventId(event, identity.host);
    return {
        event,
        eventId: eventId.slice(0, 128),
        occurredAt: (typeof options.occurredAt === 'string' && options.occurredAt.trim()) || new Date().toISOString(),
        ...(repositoryId ? { repositoryId } : { remoteUrl: identity.remoteUrl }),
        localKey,
        branch: identity.branch,
        headSha: identity.headSha,
        displayName: identity.branch,
    };
};
export async function executeWorktreeCommand(action, options) {
    if (action === 'deliver-deleted')
        return deliverDeferredDeletedEvent();
    if (action !== 'notify-created' && action !== 'notify-deleted') {
        throw new Error(`Unknown action: ${action}`);
    }
    const event = action === 'notify-created' ? 'CREATED' : 'DELETED';
    const identity = options.fromHerdrEvent === true
        ? resolveHerdrIdentity(parseHerdrWorktreeEvent(process.env, event), event)
        : resolveCwdIdentity(typeof options.cwd === 'string' ? resolve(options.cwd) : process.cwd());
    const payload = buildWorktreeLifecyclePayload(event, identity, options);
    const daemonConfig = readDaemonConfig();
    if (!daemonConfig) {
        throw new Error("Daemon token is missing. Run 'agentrunner init --token <token>' first.");
    }
    const apiUrl = normalizeApiUrl(daemonConfig.apiUrl || process.env.AGENTTEAMS_API_URL || 'https://api.agentteams.run');
    if (event === 'DELETED' && options.afterRemoval === true) {
        scheduleDeletedEventAfterRemoval(identity.worktreePath, identity.stableCwd, payload);
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