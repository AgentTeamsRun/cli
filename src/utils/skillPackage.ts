import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Skill 패키지의 로컬 소유권과 원자적 교체. `.agentteams/skills/<slug>/`의 유일한 소유자는
 * 이 모듈이며, `convention download`의 카테고리 sweep은 이 디렉터리를 건드리지 않는다.
 *
 * 계약(진입 파일, 허용 디렉터리, 크기 상한)의 SSOT는 서버가 배포하는 skill-package-guide.md다.
 * CLI는 같은 규칙을 API 호출 **전에** 한 번 더 적용해, 잘못된 패키지가 네트워크를 타기 전에
 * 사용자에게 이유를 알려준다. 최종 판정은 여전히 서버가 한다.
 */

/** `.agentteams` 아래 스킬 패키지 루트 디렉터리 이름. */
export const SKILL_PACKAGE_DIR = 'skills';

/** 스킬 manifest 파일명. conventions.manifest.json 스키마는 건드리지 않는다(D7). */
export const SKILL_MANIFEST_FILE = 'skills.manifest.json';

export const SKILL_ENTRY_FILE = 'SKILL.md';
export const SKILL_RESOURCE_DIRS = ['references', 'scripts'] as const;

export const SKILL_LIMITS = {
  entryFileBytes: 64 * 1024,
  resourceFileBytes: 256 * 1024,
  fileCount: 50,
  totalBytes: 2 * 1024 * 1024,
  pathLength: 200,
} as const;

export type SkillPackageFile = {
  relativePath: string;
  content: string;
};

/** mirror 대상. 값은 `--skill-targets` 토큰과 1:1로 대응한다. */
export const SKILL_MIRROR_TARGETS = ['agents', 'claude', 'github'] as const;
export type SkillMirrorTarget = (typeof SKILL_MIRROR_TARGETS)[number];
export const SKILL_TARGETS_NONE = 'none';

/**
 * mirror 경로와 게이팅 규칙.
 *
 * `.agents/`는 벤더 중립 경로라 항상 쓴다(COPILOT_CLI·AMP·CODEX·OPENCODE·GROK_BUILD가 직접
 * 읽는다 — 2026-08-15 프로브 실측. 판정 근거는 skill-package-guide.md §4).
 * 나머지 둘은 해당 클라이언트의 마커 디렉터리가 **실재할 때만** 쓴다. 마커도 없는데 디렉터리를
 * 만들면 그 저장소는 쓰지도 않는 도구를 위해 설정된 것처럼 보인다.
 */
const MIRROR_SPECS: Record<SkillMirrorTarget, { dir: string; markerDir: string | null }> = {
  agents: { dir: join('.agents', 'skills'), markerDir: null },
  claude: { dir: join('.claude', 'skills'), markerDir: '.claude' },
  github: { dir: join('.github', 'skills'), markerDir: '.github' },
};

export type SkillManifestEntry = {
  skillId: string;
  slug: string;
  version: string;
  /** 프로젝트 루트 기준 상대 경로. 이 목록에 있는 파일만 CLI가 지운다. */
  mirrorPaths: string[];
};

export type SkillDownloadManifestV1 = {
  version: 1;
  generatedAt: string;
  entries: SkillManifestEntry[];
};

export class SkillPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillPackageError';
  }
}

export const skillPackageRoot = (projectRoot: string): string => join(projectRoot, '.agentteams', SKILL_PACKAGE_DIR);

export const skillManifestPath = (projectRoot: string): string => join(projectRoot, '.agentteams', SKILL_MANIFEST_FILE);

/**
 * `--skill-targets` 파싱. 문법은 `--agent-files`와 같다: 콤마 구분 목록 또는 `none`.
 * 지정하지 않으면 null을 돌려주고, 호출부가 마커 탐지 기본값을 쓴다.
 */
export const parseSkillTargetsOption = (raw: unknown): SkillMirrorTarget[] | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new SkillPackageError(
      `Invalid --skill-targets value. Expected a comma-separated list or '${SKILL_TARGETS_NONE}'.`,
    );
  }

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;
  if (tokens.some((token) => token.toLowerCase() === SKILL_TARGETS_NONE)) {
    if (tokens.length > 1) {
      throw new SkillPackageError(
        `Invalid --skill-targets value: '${SKILL_TARGETS_NONE}' cannot be combined with other targets.`,
      );
    }
    return [];
  }

  const selected: SkillMirrorTarget[] = [];
  for (const token of tokens) {
    const match = SKILL_MIRROR_TARGETS.find((value) => value === token.toLowerCase());
    if (!match) {
      throw new SkillPackageError(
        `Unknown --skill-targets value: '${token}'. Valid values: ${SKILL_MIRROR_TARGETS.join(', ')}, ${SKILL_TARGETS_NONE}.`,
      );
    }
    if (!selected.includes(match)) selected.push(match);
  }

  return selected;
};

/**
 * 마커 탐지만으로는 자기 엔진 경로를 못 받는 러너를 보정하는 매핑.
 *
 * `.agents`는 마커 없이도 항상 쓰이므로 그 경로를 읽는 엔진(COPILOT_CLI·AMP·CODEX·OPENCODE·
 * GROK_BUILD)은 이미 커버된다. 거기에 `claude`를 더하면 한 엔진이 같은 스킬을 두 번 로드한다
 * (`skill-package-guide.md` §5). 그래서 `.claude/`만 읽는 CLAUDE_CODE 한 건만 매핑한다 —
 * `.claude/` 마커가 없는 저장소에서 미러를 통째로 못 받는 유일한 엔진이다.
 *
 * index-reference 엔진(CURSOR_CLI·KIRO_CLI)은 미러 대상이 아니고, 미측정 엔진(KIMI_CLI·
 * ANTIGRAVITY)은 매핑하지 않는다 — 근거 없는 매핑보다 마커 탐지 폴백이 낫다.
 */
const RUNNER_REQUIRED_TARGETS: Record<string, readonly SkillMirrorTarget[]> = {
  CLAUDE_CODE: ['claude'],
};

/**
 * 마커가 실재하는 클라이언트만 고른다. `.agents`는 마커 없이도 항상 포함된다.
 * `runnerType`을 알면 그 엔진이 읽는 경로를 마커 유무와 무관하게 추가한다.
 */
export const detectSkillMirrorTargets = (projectRoot: string, runnerType?: string): SkillMirrorTarget[] => {
  const required = new Set<SkillMirrorTarget>(runnerType ? (RUNNER_REQUIRED_TARGETS[runnerType] ?? []) : []);

  return SKILL_MIRROR_TARGETS.filter((target) => {
    if (required.has(target)) return true;
    const { markerDir } = MIRROR_SPECS[target];
    if (!markerDir) return true;
    const markerPath = join(projectRoot, markerDir);
    try {
      return lstatSync(markerPath).isDirectory();
    } catch {
      return false;
    }
  });
};

/**
 * 로컬에만 있는 패키지 slug — 매니페스트에도 원격에도 없는 것.
 *
 * `skill status`는 원래 매니페스트와 원격만 비교했다. 그래서 방금 만들고 `skill create --apply`를
 * 안 한 패키지는 **양쪽 어디에도 없어서 보이지 않았고**, 그 침묵을 convention.md가 "스킬이 제일
 * 잊기 쉽다"는 상시 산문으로 메우고 있었다. 잊은 그 시점에 도구가 말하는 편이 강하다.
 */
export const findUnregisteredSkillSlugs = (projectRoot: string, knownSlugs: Set<string>): string[] => {
  const root = skillPackageRoot(projectRoot);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !knownSlugs.has(entry.name))
    .filter((entry) => existsSync(join(root, entry.name, SKILL_ENTRY_FILE)))
    .map((entry) => entry.name)
    .sort();
};

export const mirrorDirFor = (projectRoot: string, target: SkillMirrorTarget, slug: string): string =>
  join(projectRoot, MIRROR_SPECS[target].dir, slug);

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

export const computeSkillVersion = (files: { relativePath: string; content: string }[]): string => {
  const normalized = [...files]
    .map((file) => ({ relativePath: file.relativePath, hash: sha256(file.content) }))
    .sort((left, right) =>
      left.relativePath === right.relativePath ? 0 : left.relativePath < right.relativePath ? -1 : 1,
    )
    .map((file) => `${file.relativePath}:${file.hash}`)
    .join('\n');

  return sha256(normalized);
};

const assertSafeRelativePath = (relativePath: string): void => {
  if (relativePath.length === 0 || relativePath.length > SKILL_LIMITS.pathLength) {
    throw new SkillPackageError(`Invalid path length: ${relativePath}`);
  }
  if (relativePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.includes('\\')) {
    throw new SkillPackageError(`Path must be relative and use "/" as the separator: ${relativePath}`);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new SkillPackageError(`Path must be normalized and must not traverse upward: ${relativePath}`);
  }
  if (segments.length === 1) {
    if (relativePath !== SKILL_ENTRY_FILE) {
      throw new SkillPackageError(`The only file allowed at the package root is ${SKILL_ENTRY_FILE}: ${relativePath}`);
    }
    return;
  }
  if (!(SKILL_RESOURCE_DIRS as readonly string[]).includes(segments[0])) {
    throw new SkillPackageError(
      `Resource files must live under ${SKILL_RESOURCE_DIRS.join('/ or ')}/: ${relativePath}`,
    );
  }
};

/** 패키지 계약을 로컬에서 먼저 적용한다. 실패 사유는 서버 메시지와 같은 축을 쓴다. */
export const validateSkillPackageFiles = (files: SkillPackageFile[]): void => {
  if (files.length === 0) {
    throw new SkillPackageError(`A skill package must contain ${SKILL_ENTRY_FILE}`);
  }
  if (files.length > SKILL_LIMITS.fileCount) {
    throw new SkillPackageError(`A skill package may contain at most ${SKILL_LIMITS.fileCount} files`);
  }

  const seen = new Set<string>();
  const seenLower = new Map<string, string>();
  let totalBytes = 0;

  for (const file of files) {
    assertSafeRelativePath(file.relativePath);

    if (seen.has(file.relativePath)) {
      throw new SkillPackageError(`Duplicate path: ${file.relativePath}`);
    }
    const lower = file.relativePath.toLowerCase();
    const collision = seenLower.get(lower);
    if (collision) {
      throw new SkillPackageError(`Paths collide case-insensitively: ${collision} vs ${file.relativePath}`);
    }
    seen.add(file.relativePath);
    seenLower.set(lower, file.relativePath);

    const sizeBytes = Buffer.byteLength(file.content, 'utf8');
    const limit = file.relativePath === SKILL_ENTRY_FILE ? SKILL_LIMITS.entryFileBytes : SKILL_LIMITS.resourceFileBytes;
    if (sizeBytes > limit) {
      throw new SkillPackageError(`${file.relativePath} exceeds ${limit} bytes`);
    }
    totalBytes += sizeBytes;
  }

  if (!seen.has(SKILL_ENTRY_FILE)) {
    throw new SkillPackageError(`A skill package must contain ${SKILL_ENTRY_FILE}`);
  }
  if (totalBytes > SKILL_LIMITS.totalBytes) {
    throw new SkillPackageError(`The package exceeds ${SKILL_LIMITS.totalBytes} bytes in total`);
  }
};

/**
 * Finder·Explorer가 디렉터리에 자동으로 넣는 파일. 콘텐츠 검사에 걸리면 사용자가 만들지 않은
 * 파일 때문에 push 전체가 멈춘다.
 */
const isOsJunkFileName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower === '.ds_store' ||
    lower === 'thumbs.db' ||
    lower === 'desktop.ini' ||
    lower === 'ehthumbs.db' ||
    name.startsWith('._')
  );
};

/**
 * 로컬 디렉터리에서 패키지 파일을 모은다. symlink는 따라가지 않는다 — 링크가 패키지 밖을
 * 가리키면 저장소 밖 파일이 업로드된다.
 */
export const collectSkillPackageFiles = (packageDir: string): SkillPackageFile[] => {
  const rootPath = resolve(packageDir);
  const files: SkillPackageFile[] = [];

  const walk = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (isOsJunkFileName(entry.name)) {
        continue;
      }

      const absolutePath = join(currentDir, entry.name);
      const relativePath = relative(rootPath, absolutePath).split(sep).join('/');

      if (entry.isSymbolicLink()) {
        throw new SkillPackageError(`Symlinks are not allowed inside a skill package: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      // 콘텐츠 검사는 이 수집 지점에서만 한다. validateSkillPackageFiles는 다운로드 경로
      // (commands/skill.ts)에서도 호출되는 공용 검증이라, 거기에 넣으면 이미 서버에 저장된
      // 레거시 패키지의 다운로드까지 막힌다.
      const raw = readFileSync(absolutePath);
      const content = raw.toString('utf8');
      if (!raw.equals(Buffer.from(content, 'utf8'))) {
        throw new SkillPackageError(`${relativePath} must be UTF-8 text (not valid UTF-8)`);
      }
      if (raw.includes(0)) {
        throw new SkillPackageError(`${relativePath} must be UTF-8 text (found a null byte)`);
      }

      files.push({ relativePath, content });
    }
  };

  walk(rootPath);
  validateSkillPackageFiles(files);
  return files;
};

export const readSkillManifest = (projectRoot: string): SkillDownloadManifestV1 => {
  const path = skillManifestPath(projectRoot);
  if (!existsSync(path)) {
    return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SkillDownloadManifestV1;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
    }
    return parsed;
  } catch {
    // 손상된 manifest는 "아무것도 소유하지 않은 상태"로 다룬다. 여기서 실패로 끝내면
    // 사용자가 파일을 손으로 고치기 전까지 동기화가 막힌다.
    return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
  }
};

export const writeSkillManifest = (projectRoot: string, manifest: SkillDownloadManifestV1): void => {
  const path = skillManifestPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

/**
 * 임시 디렉터리에 전부 쓴 뒤 한 번에 교체한다. 쓰기 도중 실패하면 기존 디렉터리는
 * byte-for-byte 그대로 남는다 — 부분 적용된 패키지는 "설치됐지만 깨진" 상태를 만든다.
 */
export const writePackageAtomically = (targetDir: string, files: SkillPackageFile[]): void => {
  const stagingDir = `${targetDir}.staging-${process.pid}`;
  const backupDir = `${targetDir}.backup-${process.pid}`;

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  try {
    for (const file of files) {
      assertSafeRelativePath(file.relativePath);
      const destination = join(stagingDir, ...file.relativePath.split('/'));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content, 'utf8');
    }
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  const hadPrevious = existsSync(targetDir);
  if (hadPrevious) {
    rmSync(backupDir, { recursive: true, force: true });
    renameSync(targetDir, backupDir);
  }

  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(stagingDir, targetDir);
  } catch (error) {
    // 교체 자체가 실패하면 백업을 되돌려 이전 상태를 복원한다.
    if (hadPrevious && !existsSync(targetDir)) {
      renameSync(backupDir, targetDir);
    }
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  rmSync(backupDir, { recursive: true, force: true });
};

/** manifest에 기록된 경로만 지운다. 사용자가 mirror 디렉터리에 둔 파일은 건드리지 않는다. */
export const removeManifestPaths = (projectRoot: string, relativePaths: string[]): void => {
  for (const relativePath of relativePaths) {
    const absolutePath = join(projectRoot, ...relativePath.split('/'));
    // 프로젝트 루트를 벗어나는 기록은 무시한다(손상되거나 조작된 manifest 방어).
    if (!resolve(absolutePath).startsWith(resolve(projectRoot) + sep)) {
      continue;
    }
    rmSync(absolutePath, { recursive: true, force: true });
  }
};

const GITIGNORE_MARKER = '# AgentTeams skill mirrors (generated — do not edit)';

/**
 * mirror 디렉터리를 `.gitignore`에 넣는다. mirror는 `.agentteams/skills/`에서 파생된 사본이라
 * 커밋 대상이 아니다. `--commit-mirrors`를 준 프로젝트는 이 호출을 건너뛴다.
 */
export const ensureMirrorGitignore = (projectRoot: string, targets: SkillMirrorTarget[]): void => {
  if (targets.length === 0) {
    return;
  }

  const gitignorePath = join(projectRoot, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const wanted = targets.map((target) => `${MIRROR_SPECS[target].dir.split(sep).join('/')}/`);
  const missing = wanted.filter((entry) => !existing.split(/\r?\n/).some((line) => line.trim() === entry));

  if (missing.length === 0) {
    return;
  }

  const block = existing.includes(GITIGNORE_MARKER) ? missing.join('\n') : [GITIGNORE_MARKER, ...missing].join('\n');
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${existing}${separator}${block}\n`, 'utf8');
};
