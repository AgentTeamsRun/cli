import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { CONVENTION_DIR, CONVENTION_INDEX_FILE, conventionDownload, conventionStatus, findProjectRoot, readDeployedConventionPaths, } from './convention.js';
import { executeSkillCommand } from './skill.js';
import { loadConfigWithCredential } from '../utils/config.js';
import { resolveApiContext } from '../utils/apiContext.js';
const ALWAYS_ON = 'always_on';
const hashOf = (content) => createHash('sha256').update(content).digest('hex');
/**
 * 파일 1건의 상태. 없거나 못 읽으면 `null`이고, 호출부는 그것을 "부재"로 다룬다.
 * frontmatter가 깨진 파일은 트리거 미상으로 보고 always_on이 아닌 것으로 취급한다 —
 * 재독 목록에 확신 없는 항목을 넣는 것보다 빠뜨리는 쪽이 낫다(잘못된 재독은 매 세션 반복된다).
 */
const readFileState = (projectRoot, relativePath) => {
    const absolutePath = join(projectRoot, relativePath);
    if (!existsSync(absolutePath))
        return null;
    let content;
    try {
        content = readFileSync(absolutePath, 'utf8');
    }
    catch {
        return null;
    }
    let alwaysOn = false;
    try {
        const trigger = matter(content).data?.trigger;
        alwaysOn = typeof trigger === 'string' && trigger.trim().toLowerCase() === ALWAYS_ON;
    }
    catch {
        alwaysOn = false;
    }
    return { hash: hashOf(content), alwaysOn };
};
/**
 * 스냅샷 대상 = 매니페스트에 기록된 배포 파일 + `convention.md`.
 * 후자는 매니페스트 엔트리가 아니라서 명시적으로 더해야 한다.
 */
export const snapshotConventionFiles = (projectRoot) => {
    const paths = [...readDeployedConventionPaths(projectRoot), `${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}`];
    const states = new Map();
    for (const path of paths) {
        const state = readFileState(projectRoot, path);
        if (state)
            states.set(path, state);
    }
    return states;
};
/**
 * 재독 계획. **always_on만** 대상이다 — `model_decision` 파일은 정의상 필요할 때 여는 등급이라,
 * 세션 시작에 미리 읽히면 always_on을 늘린 것과 같아진다.
 *
 * 판정 기준은 updatedAt이 아니라 **내용 해시**다. 서버 메타데이터가 움직여도 배포된 바이트가
 * 같으면 에이전트가 다시 읽을 이유가 없고, 매니페스트에 없는 `convention.md`처럼 메타데이터
 * 자체가 없는 파일도 같은 규칙으로 다뤄진다.
 *
 * 사라진 always_on은 `reread`에 넣을 수 없다 — 읽을 파일이 없다. 그래서 `invalidated`로
 * 분리한다. 에이전트 컨텍스트에는 그 규칙이 아직 남아 있으므로 "무효"라는 신호가 필요하다.
 */
export const diffConventionSnapshots = (before, after) => {
    const reread = [];
    for (const [path, state] of after) {
        if (!state.alwaysOn)
            continue;
        if (before.get(path)?.hash === state.hash)
            continue;
        reread.push(path);
    }
    const invalidated = [];
    for (const [path, state] of before) {
        if (state.alwaysOn && !after.has(path))
            invalidated.push(path);
    }
    return { reread: reread.sort(), invalidated: invalidated.sort() };
};
const describeError = (error) => (error instanceof Error ? error.message : String(error));
const buildSummary = (result) => {
    if (result.reread.length === 0 && result.invalidated.length === 0) {
        return result.notes.length > 0 ? 'Nothing to re-read' : '✓ Up to date';
    }
    const parts = [];
    if (result.reread.length > 0)
        parts.push(`re-read ${result.reread.length} file(s)`);
    if (result.invalidated.length > 0)
        parts.push(`${result.invalidated.length} rule(s) no longer apply`);
    return parts.join('; ');
};
export async function sessionSync(options) {
    const notes = [];
    const synced = { conventions: false, skills: false, platformGuides: false };
    let cliUpdateAvailable = false;
    const cwd = options?.cwd ?? process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        return {
            reread: [],
            invalidated: [],
            synced,
            cliUpdateAvailable,
            notes: ['Not an AgentTeams project — nothing to sync.'],
            summary: '✓ Up to date',
        };
    }
    const before = snapshotConventionFiles(projectRoot);
    // 컨벤션 판정. `conventionStatus`가 CLI 버전 확인까지 겸하므로 한 번에 둘 다 얻는다.
    let conventionUpdateAvailable = false;
    try {
        const status = await conventionStatus({ cwd });
        conventionUpdateAvailable = status.conventionUpdateAvailable;
        synced.platformGuides = status.platformGuidesChanged;
        cliUpdateAvailable = status.cliUpdateAvailable;
        if (status.credentialProblem)
            notes.push(`Convention check skipped: ${status.credentialProblem}`);
    }
    catch (error) {
        notes.push(`Convention check skipped: ${describeError(error)}`);
    }
    // 스킬을 **먼저** 맞춘다. 스킬 목록이 바뀌면 convention.md의 Skill Index도 달라지므로,
    // 컨벤션 다운로드가 앞서면 방금 바뀐 스킬이 반영되지 않은 인덱스를 받게 된다.
    await syncSkills(cwd, synced, notes);
    // 스킬 변경은 `checkConventionFreshness`가 보지 않는 축이다(그쪽은 컨벤션 레코드와 플랫폼
    // 가이드 해시만 본다). 이 조건이 없으면 스킬만 바뀐 세션에서 Skill Index가 낡은 채로 남는다.
    if (conventionUpdateAvailable || synced.platformGuides || synced.skills) {
        try {
            await conventionDownload({ cwd });
            synced.conventions = true;
        }
        catch (error) {
            notes.push(`Convention download failed: ${describeError(error)}`);
        }
    }
    const { reread, invalidated } = diffConventionSnapshots(before, snapshotConventionFiles(projectRoot));
    const result = { reread, invalidated, synced, cliUpdateAvailable, notes };
    return { ...result, summary: buildSummary(result) };
}
/**
 * 스킬은 status로 게이트한 뒤에만 받는다. `skill download`가 판정 없이 로컬 패키지를 전부
 * 덮어쓰기 때문이다 — 게이트를 빼면 로컬에서 작성 중인 패키지가 세션 시작마다 사라진다.
 */
async function syncSkills(cwd, synced, notes) {
    let apiContext;
    try {
        const config = await loadConfigWithCredential();
        if (!config) {
            notes.push('Skill check skipped: project is not configured.');
            return;
        }
        const { apiUrl, headers } = resolveApiContext(config);
        apiContext = { apiUrl, headers, projectId: config.projectId };
    }
    catch (error) {
        notes.push(`Skill check skipped: ${describeError(error)}`);
        return;
    }
    const { apiUrl, headers, projectId } = apiContext;
    let changed = [];
    try {
        const status = (await executeSkillCommand(apiUrl, projectId, headers, 'status', { cwd }));
        // 미등록 패키지는 다운로드로 해결되지 않는다 — 서버에 없으니 받을 게 없다. 그래서 게이트
        // 앞에서 먼저 보고한다: 여기서 반환해 버리면 원격에 변경이 없을 때 이 신호가 통째로 묻힌다.
        if (Array.isArray(status.unregistered) && status.unregistered.length > 0) {
            notes.push(`Local skill package(s) not registered on the server: ${status.unregistered.join(', ')} — ` +
                `run 'agentteams skill create --dir .agentteams/skills/<slug> --apply'.`);
        }
        if (!status?.updateAvailable)
            return;
        changed = Array.isArray(status.changes) ? status.changes : [];
    }
    catch (error) {
        notes.push(`Skill check skipped: ${describeError(error)}`);
        return;
    }
    try {
        await executeSkillCommand(apiUrl, projectId, headers, 'download', { cwd });
        synced.skills = true;
        // download는 로컬 사본을 덮어쓴다. 편집 중이던 패키지가 있으면 사라지므로 이름을 남긴다.
        const overwritten = changed.filter((change) => change.type === 'updated').map((change) => change.slug);
        if (overwritten.length > 0) {
            notes.push(`Overwrote local copies of updated skill package(s): ${overwritten.join(', ')}`);
        }
    }
    catch (error) {
        notes.push(`Skill download failed: ${describeError(error)}`);
    }
}
export async function executeSessionCommand(action, options) {
    switch (action) {
        case 'sync':
            return sessionSync({ cwd: options?.cwd });
        default:
            throw new Error(`Unknown session action: ${action}. Use sync.`);
    }
}
//# sourceMappingURL=session.js.map