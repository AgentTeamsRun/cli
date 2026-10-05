import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import {
  CONVENTION_DIR,
  CONVENTION_INDEX_FILE,
  conventionDownload,
  conventionStatus,
  findProjectRoot,
  readDeployedConventionPaths,
} from './convention.js';
import { executeSkillCommand } from './skill.js';
import {
  DEFAULT_SESSION_HOOK_CLIENT_ID,
  findSessionHookClient,
  isSessionHookClientId,
  isSessionHookScope,
  SESSION_HOOK_CLIENT_IDS,
  SESSION_HOOK_SCOPES,
} from '../session-hooks/clients.js';
import { installSessionHook, uninstallSessionHook, type SessionHookResult } from '../session-hooks/install.js';
import { loadConfigWithCredential } from '../utils/config.js';
import { resolveApiContext } from '../utils/apiContext.js';

/**
 * `agentteams session sync` — 세션 시작 동기화.
 *
 * convention.md의 Session Start 절이 러너에게 시키던 판정을 이쪽으로 옮긴 명령이다. 그 절은
 * status 두 번, download 두 번, 실패 3종 분기, 미러 타깃 플래그를 산문으로 설명했는데,
 * 에이전트가 그걸 읽고 매 세션 재현해야 할 이유가 없다. 여기서는 하나만 답한다:
 * **지금 무엇을 다시 읽어야 하는가**(`reread`).
 *
 * 두 가지 불변식이 있다.
 *
 * 1) `skill status`로 불필요한 다운로드를 줄인다. 실제 파일 변경은 다운로드 경로의
 *    공통 충돌 검사가 보호하며, 세션 동기화는 강제 옵션을 전달하지 않는다.
 * 2) 어떤 실패도 예외로 새어나가지 않는다. 이 명령이 죽으면 에이전트가 본 작업을 시작도 못 하고
 *    멈춘다. 실패는 전부 `notes`로 내려보내고 정상 종료한다.
 */
export type SessionSyncResult = {
  /** 지금 다시 읽어야 하는 파일. 내용이 바뀐 **always_on** 파일만 들어간다. */
  reread: string[];
  /** 서버에서 사라진 always_on 파일. 재독할 대상이 없으므로 `reread`와 분리한다. */
  invalidated: string[];
  synced: { conventions: boolean; skills: boolean; platformGuides: boolean };
  /** 보고만 한다 — 실행 중인 바이너리를 세션 도중에 교체하지 않는다. */
  cliUpdateAvailable: boolean;
  notes: string[];
  skillConflicts: number;
  summary: string;
};

export type ConventionFileState = { hash: string; alwaysOn: boolean };
export type ConventionSnapshot = Map<string, ConventionFileState>;

const ALWAYS_ON = 'always_on';

/** 프로젝트 밖 결과의 표식. 훅 출력은 이 결과를 무출력으로 다루므로 문구를 한 곳에 둔다. */
export const NOT_A_PROJECT_NOTE = 'Not an AgentTeams project — nothing to sync.';

const hashOf = (content: string): string => createHash('sha256').update(content).digest('hex');

/**
 * 파일 1건의 상태. 없거나 못 읽으면 `null`이고, 호출부는 그것을 "부재"로 다룬다.
 * frontmatter가 깨진 파일은 트리거 미상으로 보고 always_on이 아닌 것으로 취급한다 —
 * 재독 목록에 확신 없는 항목을 넣는 것보다 빠뜨리는 쪽이 낫다(잘못된 재독은 매 세션 반복된다).
 */
const readFileState = (projectRoot: string, relativePath: string): ConventionFileState | null => {
  const absolutePath = join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) return null;

  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }

  let alwaysOn = false;
  try {
    const trigger = matter(content).data?.trigger;
    alwaysOn = typeof trigger === 'string' && trigger.trim().toLowerCase() === ALWAYS_ON;
  } catch {
    alwaysOn = false;
  }

  return { hash: hashOf(content), alwaysOn };
};

/**
 * 스냅샷 대상 = 매니페스트에 기록된 배포 파일 + `convention.md`.
 * 후자는 매니페스트 엔트리가 아니라서 명시적으로 더해야 한다.
 */
export const snapshotConventionFiles = (projectRoot: string): ConventionSnapshot => {
  const paths = [...readDeployedConventionPaths(projectRoot), `${CONVENTION_DIR}/${CONVENTION_INDEX_FILE}`];
  const states: ConventionSnapshot = new Map();
  for (const path of paths) {
    const state = readFileState(projectRoot, path);
    if (state) states.set(path, state);
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
export const diffConventionSnapshots = (
  before: ConventionSnapshot,
  after: ConventionSnapshot,
): { reread: string[]; invalidated: string[] } => {
  const reread: string[] = [];
  for (const [path, state] of after) {
    if (!state.alwaysOn) continue;
    if (before.get(path)?.hash === state.hash) continue;
    reread.push(path);
  }

  const invalidated: string[] = [];
  for (const [path, state] of before) {
    if (state.alwaysOn && !after.has(path)) invalidated.push(path);
  }

  return { reread: reread.sort(), invalidated: invalidated.sort() };
};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const buildSummary = (result: Omit<SessionSyncResult, 'summary'>): string => {
  if (result.reread.length === 0 && result.invalidated.length === 0 && result.skillConflicts === 0) {
    return result.notes.length > 0 ? 'Nothing to re-read' : '✓ Up to date';
  }
  const parts: string[] = [];
  if (result.skillConflicts > 0) parts.push(`${result.skillConflicts} skill package(s) preserved — see notes`);
  if (result.reread.length > 0) parts.push(`re-read ${result.reread.length} file(s)`);
  if (result.invalidated.length > 0) parts.push(`${result.invalidated.length} rule(s) no longer apply`);
  return parts.join('; ');
};

export async function sessionSync(options?: { cwd?: string }): Promise<SessionSyncResult> {
  const notes: string[] = [];
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
      skillConflicts: 0,
      notes: [NOT_A_PROJECT_NOTE],
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
    if (status.credentialProblem) notes.push(`Convention check skipped: ${status.credentialProblem}`);
  } catch (error) {
    notes.push(`Convention check skipped: ${describeError(error)}`);
  }

  // 스킬을 **먼저** 맞춘다. 스킬 목록이 바뀌면 convention.md의 Skill Index도 달라지므로,
  // 컨벤션 다운로드가 앞서면 방금 바뀐 스킬이 반영되지 않은 인덱스를 받게 된다.
  const skillConflicts = await syncSkills(cwd, synced, notes);

  // 스킬 변경은 `checkConventionFreshness`가 보지 않는 축이다(그쪽은 컨벤션 레코드와 플랫폼
  // 가이드 해시만 본다). 이 조건이 없으면 스킬만 바뀐 세션에서 Skill Index가 낡은 채로 남는다.
  if (conventionUpdateAvailable || synced.platformGuides || synced.skills) {
    try {
      await conventionDownload({ cwd });
      synced.conventions = true;
    } catch (error) {
      notes.push(`Convention download failed: ${describeError(error)}`);
    }
  }

  const { reread, invalidated } = diffConventionSnapshots(before, snapshotConventionFiles(projectRoot));

  const result = { reread, invalidated, synced, cliUpdateAvailable, notes, skillConflicts };
  return { ...result, summary: buildSummary(result) };
}

/**
 * 충돌 안내를 한 줄로 요약한다. 패키지마다 미러 경로 전체가 붙던 기존 형태는 세션 시작 출력의
 * 대부분을 차지했으므로(실측 96%), slug 목록과 해결 명령만 남긴다. 상세(보존 경로)는
 * `skill download` 출력에서 그대로 확인할 수 있다.
 *
 * 반환은 항상 0개 또는 1개다. `conflicts`가 비어 있는데 `conflictNotes`만 있는 비정상 입력에는
 * 정보를 잃지 않도록 기존 목록을 그대로 돌려준다.
 */
export const summarizeSkillConflicts = (
  conflicts: { slug: string }[] | undefined | null,
  fallbackNotes: string[] | undefined | null,
): string[] => {
  if (!Array.isArray(conflicts) || conflicts.length === 0) return [...(fallbackNotes ?? [])];
  const slugs = conflicts.map((conflict) => conflict.slug).join(', ');
  return [
    `${conflicts.length} skill package(s) kept local changes and were not updated: ${slugs}. ` +
      `Run 'agentteams skill download --id <id> --force' per package, or ` +
      `'agentteams skill download --force --all' to replace all with the server state. ` +
      `Preserved paths are listed in the 'agentteams skill download' output.`,
  ];
};

/**
 * 원격 변경이 있을 때만 다운로드한다. 충돌한 패키지는 보존하고, 패키지별 상세(경로 목록) 대신
 * slug 목록과 해결 명령만 담은 한 줄을 notes에 전달한다. 상세는 `skill download` 명령의 출력이
 * 그대로 보여주므로(`commands/skill.ts`의 conflictNotes는 수정하지 않음), 요약 줄에서 그쪽을
 * 안내한다. `skill status`는 충돌 경로를 보여주지 않아 상세 경로로 쓸 수 없다.
 */
async function syncSkills(cwd: string, synced: { skills: boolean }, notes: string[]): Promise<number> {
  let apiContext: { apiUrl: string; headers: Record<string, string>; projectId: string };
  try {
    const config = await loadConfigWithCredential();
    if (!config) {
      notes.push('Skill check skipped: project is not configured.');
      return 0;
    }
    const { apiUrl, headers } = resolveApiContext(config);
    apiContext = { apiUrl, headers, projectId: config.projectId };
  } catch (error) {
    notes.push(`Skill check skipped: ${describeError(error)}`);
    return 0;
  }

  const { apiUrl, headers, projectId } = apiContext;
  try {
    const status = (await executeSkillCommand(apiUrl, projectId, headers, 'status', { cwd })) as {
      updateAvailable?: boolean;
      changes?: { slug: string; type: string }[];
      unregistered?: string[];
    };
    // 미등록 패키지는 다운로드로 해결되지 않는다 — 서버에 없으니 받을 게 없다. 그래서 게이트
    // 앞에서 먼저 보고한다: 여기서 반환해 버리면 원격에 변경이 없을 때 이 신호가 통째로 묻힌다.
    if (Array.isArray(status.unregistered) && status.unregistered.length > 0) {
      notes.push(
        `Local skill package(s) not registered on the server: ${status.unregistered.join(', ')} — ` +
          `run 'agentteams skill create --dir .agentteams/skills/<slug> --apply'.`,
      );
    }
    if (!status?.updateAvailable) return 0;
  } catch (error) {
    notes.push(`Skill check skipped: ${describeError(error)}`);
    return 0;
  }

  try {
    const result = await executeSkillCommand(apiUrl, projectId, headers, 'download', { cwd, updatesOnly: true });
    synced.skills = result.downloaded.length > 0 || result.removed.length > 0;
    notes.push(...summarizeSkillConflicts(result.conflicts, result.conflictNotes));
    return result.conflicts?.length ?? 0;
  } catch (error) {
    notes.push(`Skill download failed: ${describeError(error)}`);
    return 0;
  }
}

const bullet = (item: string): string => `- ${item}`;

/**
 * Claude Code SessionStart 훅 출력(https://code.claude.com/docs/en/hooks). `additionalContext`는
 * 세션 컨텍스트에 그대로 주입되므로, 에이전트가 할 일만 문장으로 남긴다.
 *
 * 프로젝트 밖이면 `null`이다. 훅은 사용자 설정에 걸려 모든 저장소의 세션에서 돌 수 있는데,
 * 무관한 세션에 "이미 동기화했다"는 문장을 넣으면 그 자체가 잘못된 컨텍스트가 된다.
 *
 * CLI 업데이트는 알리기만 한다. 전역 설치는 사용자 판단이라 에이전트에게 설치를 시키지 않는다.
 */
export function formatClaudeCodeSessionStartHook(result: SessionSyncResult): string | null {
  if (result.notes.includes(NOT_A_PROJECT_NOTE)) return null;

  const lines = [
    "AgentTeams session sync already ran at session start — do not run 'agentteams session sync' again this session.",
  ];
  if (result.reread.length > 0) {
    lines.push('These convention files changed during sync — re-read these files:', ...result.reread.map(bullet));
  }
  if (result.invalidated.length > 0) {
    lines.push('These rules no longer apply (removed from the server):', ...result.invalidated.map(bullet));
  }
  if (result.skillConflicts > 0) {
    lines.push(`${result.skillConflicts} skill package(s) preserved — see notes`);
  }
  if (result.notes.length > 0) {
    lines.push('Notes:', ...result.notes.map(bullet));
  }
  if (lines.length === 1) lines.push(result.summary);
  if (result.cliUpdateAvailable) {
    lines.push("AgentTeams CLI update available — tell the user to run 'npm install -g @agentteams/cli'.");
  }

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  });
}

/**
 * `session hook install|uninstall`의 입력 검증. user 스코프는 이 머신의 모든 세션에 걸리므로
 * `--yes` 없이는 쓰지 않는다 — 미리보기(`--dry-run`)는 쓰지 않으니 허용한다.
 */
export function runSessionHookCommand(
  action: 'install' | 'uninstall',
  options: Record<string, unknown> = {},
  // Jest ESM 환경에서는 `process.env.HOME`을 바꿔도 `os.homedir()`가 실제 홈을 돌려준다.
  // 테스트가 사용자의 실제 설정 파일을 쓰지 않도록 홈은 주입받는다.
  context: { homeDir?: string } = {},
): SessionHookResult {
  const homeDir = context.homeDir ?? homedir();
  const clientId = options.client ?? DEFAULT_SESSION_HOOK_CLIENT_ID;
  if (!isSessionHookClientId(clientId)) {
    throw new Error(`Unsupported --client: ${String(clientId)}. Use one of: ${SESSION_HOOK_CLIENT_IDS.join(', ')}.`);
  }
  const scope = options.scope ?? 'project';
  if (!isSessionHookScope(scope)) {
    throw new Error(`Unsupported --scope: ${String(scope)}. Use one of: ${SESSION_HOOK_SCOPES.join(', ')}.`);
  }
  const dryRun = options.dryRun === true;
  if (scope === 'user' && !dryRun && options.yes !== true) {
    const client = findSessionHookClient(clientId);
    const path = client?.configPath('user', { cwd: process.cwd(), homeDir }) ?? 'the user settings file';
    throw new Error(
      `--scope user edits ${path}, which applies to every ${client?.label ?? clientId} session on this machine. Re-run with --scope user --yes to apply, or add --dry-run to preview.`,
    );
  }

  const hookOptions = {
    clientId,
    scope,
    cwd: typeof options.cwd === 'string' ? options.cwd : undefined,
    homeDir,
    dryRun,
  };
  return action === 'install' ? installSessionHook(hookOptions) : uninstallSessionHook(hookOptions);
}

export async function executeSessionCommand(action: string, options: any): Promise<unknown> {
  switch (action) {
    case 'sync':
      return sessionSync({ cwd: options?.cwd });
    case 'hook-install':
      return runSessionHookCommand('install', options);
    case 'hook-uninstall':
      return runSessionHookCommand('uninstall', options);
    default:
      throw new Error(`Unknown session action: ${action}. Use sync, hook install, or hook uninstall.`);
  }
}
