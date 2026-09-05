import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createSkill, deleteSkill, downloadSkill, getSkill, listSkills, updateSkill } from '../api/skill.js';
import { resolveSessionRunnerType } from '../utils/agentIdentity.js';
import {
  SKILL_ENTRY_FILE,
  SKILL_PACKAGE_DIR,
  SkillPackageError,
  type SkillManifestEntry,
  type SkillMirrorTarget,
  type SkillPackageFile,
  collectSkillPackageFiles,
  detectSkillMirrorTargets,
  findUnregisteredSkillSlugs,
  ensureMirrorGitignore,
  mirrorDirFor,
  parseSkillTargetsOption,
  readSkillManifest,
  skillPackageRoot,
  skillManifestPath,
  validateSkillPackageFiles,
} from '../utils/skillPackage.js';

import {
  assertSkillSlug,
  commitSkillChanges,
  findSkillConflicts,
  readSkillTree,
  skillEntryRoots,
  skillFileHashes,
  type SkillConflict,
  type SkillTreeChange,
} from '../utils/skillSync.js';

type SkillOptions = Record<string, any>;

const requireId = (options: SkillOptions): string => {
  const id = options.id ?? options.skillId;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('--id is required');
  }
  return id.trim();
};

const projectRootOf = (options: SkillOptions): string => resolve(options.cwd ?? process.cwd());

/**
 * `--dir`(패키지 디렉터리) 또는 `--file`(SKILL.md 경로)를 받아 패키지 루트를 정한다.
 * SKILL.md를 가리켰다면 그 부모 디렉터리가 패키지 루트다.
 */
const resolvePackageDir = (options: SkillOptions): string => {
  const raw = options.dir ?? options.file;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('--dir (package directory) or --file (SKILL.md path) is required');
  }

  const target = resolve(projectRootOf(options), raw.trim());
  if (!existsSync(target)) {
    throw new Error(`Path not found: ${raw}`);
  }

  return statSync(target).isDirectory() ? target : dirname(target);
};

const slugFor = (options: SkillOptions, packageDir: string): string => {
  const slug =
    typeof options.slug === 'string' && options.slug.trim().length > 0 ? options.slug.trim() : basename(packageDir);
  return slug;
};

const toRelativeProjectPath = (projectRoot: string, absolutePath: string): string =>
  relative(projectRoot, absolutePath).split(sep).join('/');

/**
 * mirror 대상 결정. `--skill-targets`가 있으면 그것만 쓰고, 없으면 마커가 실재하는 클라이언트에
 * **현재 엔진이 읽는 경로**를 더한다. 마커 탐지만으로는 `.claude/`가 없는 저장소의 CLAUDE_CODE가
 * 미러를 통째로 못 받는다 — 그 보정을 러너가 매번 `--skill-targets`로 하던 것을 여기로 옮겼다.
 * 사용자 홈 아래 경로는 어떤 경우에도 대상이 아니다 — 전부 프로젝트 로컬이다.
 */
const resolveMirrorTargets = (projectRoot: string, options: SkillOptions): SkillMirrorTarget[] => {
  const explicit = parseSkillTargetsOption(options.skillTargets);
  return explicit ?? detectSkillMirrorTargets(projectRoot, resolveSessionRunnerType());
};

/** 구형 flat `.agentteams/skills/<name>.md`. 이관 전에는 지우지 않고 경고만 한다. */
const findLegacyFlatFiles = (projectRoot: string): string[] => {
  const root = skillPackageRoot(projectRoot);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => join(root, entry.name));
};

/**
 * 원격 스킬 목록을 **끝까지** 모은다.
 *
 * 첫 페이지만 보고 그것을 전체 상태로 간주하면, 101번째부터의 스킬이 manifest에서 stale로
 * 판정되어 멀쩡한 로컬 패키지와 mirror가 삭제된다. 중간 페이지가 실패하면 아무것도 정리하지
 * 않도록 그대로 throw한다 — 불완전한 목록으로는 "사라진 스킬"을 판단할 수 없다.
 */
const fetchAllSkills = async (
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
): Promise<{ id: string; slug: string; version: string }[]> => {
  const pageSize = 100;
  const collected: { id: string; slug: string; version: string }[] = [];

  for (let page = 1; ; page += 1) {
    const response = await listSkills(apiUrl, projectId, headers, { page, pageSize });
    const rows = Array.isArray(response?.data) ? response.data : [];
    collected.push(...rows);

    const totalPages = Number(response?.meta?.totalPages ?? 0);
    if (rows.length === 0 || !Number.isFinite(totalPages) || page >= totalPages) {
      break;
    }
  }

  return collected;
};

const skillDownload = async (
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  options: SkillOptions,
) => {
  const projectRoot = projectRootOf(options);
  const targets = resolveMirrorTargets(projectRoot, options);

  const selectedId = options.id === undefined ? undefined : requireId(options).replace(/^agentteams_skl_/, '');
  if (options.all === true && (options.force !== true || selectedId)) {
    throw new SkillPackageError('--all requires --force and cannot be combined with --id.');
  }
  if (options.force === true && !selectedId && options.all !== true) {
    throw new SkillPackageError('--force requires --id or --all to explicitly select the replacement scope.');
  }
  const allSkills = await fetchAllSkills(apiUrl, projectId, headers);
  const skills = selectedId ? allSkills.filter((skill) => skill.id === selectedId) : allSkills;

  const manifestPath = skillManifestPath(projectRoot);
  const previousManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined;
  const previous = readSkillManifest(projectRoot);
  if (selectedId && skills.length === 0 && !previous.entries.some((entry) => entry.skillId === selectedId)) {
    throw new SkillPackageError(`Skill not found in the server or local manifest: ${selectedId}`);
  }
  const entries: SkillManifestEntry[] = [...previous.entries];
  const written: { slug: string; version: string }[] = [];
  const removed: string[] = [];
  const conflicts: { skillId: string; slug: string; paths: SkillConflict[] }[] = [];
  const changes: SkillTreeChange[] = [];
  const claimedRoots = new Set<string>();
  const previousOwners = new Map<string, Set<string>>();
  const invalidEntries = new Set<SkillManifestEntry>();
  for (const entry of previous.entries) {
    try {
      // 미러 기록이 잘못되어도 유효한 원본의 소유권은 먼저 보존한다.
      assertSkillSlug(entry.slug);
      const canonical = `.agentteams/skills/${entry.slug}`;
      previousOwners.set(canonical, new Set([...(previousOwners.get(canonical) ?? []), entry.skillId]));
      for (const root of skillEntryRoots(entry)) {
        previousOwners.set(root, new Set([...(previousOwners.get(root) ?? []), entry.skillId]));
      }
    } catch {
      invalidEntries.add(entry);
    }
  }
  const remoteOwners = new Map<string, Set<string>>();
  for (const skill of allSkills) {
    remoteOwners.set(skill.slug, new Set([...(remoteOwners.get(skill.slug) ?? []), skill.id]));
  }
  const preserveUnsafe = (entry: SkillManifestEntry, path: string) => {
    conflicts.push({ skillId: entry.skillId, slug: entry.slug, paths: [{ path, reason: 'unsafe' }] });
  };

  const prepare = (
    old: SkillManifestEntry | undefined,
    next: SkillManifestEntry | undefined,
    files: SkillPackageFile[],
  ) => {
    const entry = next ?? old!;
    if (old && invalidEntries.has(old)) {
      preserveUnsafe(entry, '.agentteams/skills.manifest.json');
      return;
    }
    const oldRoots = old ? skillEntryRoots(old) : [];
    const nextRoots = next ? skillEntryRoots(next) : [];
    const roots = [...new Set([...oldRoots, ...nextRoots])];
    for (const root of roots) {
      const owners = previousOwners.get(root);
      if ((owners && [...owners].some((owner) => owner !== entry.skillId)) || claimedRoots.has(root)) {
        preserveUnsafe(entry, root);
        return;
      }
    }
    if (next && (remoteOwners.get(next.slug)?.size ?? 0) > 1) {
      preserveUnsafe(next, `.agentteams/skills/${next.slug}`);
      return;
    }
    const pending = roots.map((root) => ({
      root,
      files: nextRoots.includes(root) ? files : null,
      before: readSkillTree(projectRoot, root),
    }));
    for (const root of roots) {
      claimedRoots.add(root);
    }
    const found: SkillConflict[] = [];
    const skipped: SkillConflict[] = [];
    const skippedRoots = new Set<string>();
    for (const change of pending) {
      const isMirror = !change.root.startsWith('.agentteams/');
      // 사본 루트 전체의 부재는 클라이언트 설정 정리로 본다. 파일 단위 삭제·편집은 계속 보호한다.
      if (isMirror && Object.keys(change.before).length === 0) continue;
      const rootConflicts = findSkillConflicts(change.root, change.before, old?.fileHashes);
      if (
        isMirror &&
        next &&
        (!old || old.slug === next.slug) &&
        rootConflicts.some((item) => item.reason === 'unsafe')
      ) {
        skippedRoots.add(change.root);
        skipped.push(...rootConflicts);
        continue;
      }
      found.push(...rootConflicts);
      // v1 원본을 사용자가 지웠으면 새 설치로 취급하지 않는다.
      if (!old?.fileHashes && oldRoots.includes(change.root) && Object.keys(change.before).length === 0) {
        found.push({ path: change.root, reason: 'deleted' });
      }
    }
    if (found.some((conflict) => conflict.reason === 'unsafe') || (found.length > 0 && options.force !== true)) {
      const entry = next ?? old!;
      conflicts.push({ skillId: entry.skillId, slug: entry.slug, paths: [...found, ...skipped] });
      return;
    }
    if (next && skippedRoots.size > 0) {
      const isSkipped = (path: string) => [...skippedRoots].some((root) => path.startsWith(`${root}/`));
      next.mirrorPaths = [
        ...next.mirrorPaths.filter((path) => !isSkipped(path)),
        ...(old?.mirrorPaths ?? []).filter(isSkipped),
      ];
      next.fileHashes = Object.fromEntries([
        ...Object.entries(next.fileHashes ?? {}).filter(([path]) => !isSkipped(path)),
        ...Object.entries(old?.fileHashes ?? {}).filter(([path]) => isSkipped(path)),
      ]);
      conflicts.push({ skillId: next.skillId, slug: next.slug, paths: skipped });
    }
    changes.push(...pending.filter((change) => !skippedRoots.has(change.root)));
    if (old) entries.splice(entries.indexOf(old), 1);
    if (next) {
      entries.push(next);
      written.push({ slug: next.slug, version: next.version });
    }
    if (old && old.slug !== next?.slug) removed.push(old.slug);
  };

  for (const summary of skills) {
    const old = previous.entries.find((entry) => entry.skillId === summary.id);
    // 세션 자동 동기화는 이미 배포된 버전의 본문을 다시 받지 않는다. 수동 다운로드는 항상 재검사한다.
    if (
      options.updatesOnly === true &&
      options.force !== true &&
      old?.fileHashes &&
      !invalidEntries.has(old) &&
      old.slug === summary.slug &&
      old.version === summary.version &&
      (remoteOwners.get(summary.slug)?.size ?? 0) === 1 &&
      skillEntryRoots(old).every((root) => previousOwners.get(root)?.size === 1)
    )
      continue;
    try {
      assertSkillSlug(summary.slug);
    } catch {
      preserveUnsafe(
        { skillId: summary.id, slug: summary.slug, version: summary.version, mirrorPaths: [] },
        '.agentteams/skills.manifest.json',
      );
      continue;
    }
    const payload = await downloadSkill(apiUrl, projectId, headers, summary.id);
    const files: SkillPackageFile[] = (payload?.data?.files ?? []).map((file: any) => ({
      relativePath: String(file.relativePath),
      content: String(file.content ?? ''),
    }));
    validateSkillPackageFiles(files);
    const roots = [
      `.agentteams/skills/${summary.slug}`,
      ...targets.map((target) => toRelativeProjectPath(projectRoot, mirrorDirFor(projectRoot, target, summary.slug))),
    ];
    const next: SkillManifestEntry = {
      skillId: summary.id,
      slug: summary.slug,
      version: summary.version,
      mirrorPaths: roots.slice(1).flatMap((root) => files.map((file) => `${root}/${file.relativePath}`)),
      fileHashes: skillFileHashes(roots, files),
    };
    prepare(old, next, files);
  }
  const liveIds = new Set(skills.map((skill) => skill.id));
  for (const old of previous.entries) {
    if ((!selectedId || old.skillId === selectedId) && !liveIds.has(old.skillId)) prepare(old, undefined, []);
  }

  if (changes.length > 0) {
    commitSkillChanges(
      projectRoot,
      changes,
      `${JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), entries }, null, 2)}\n`,
      previousManifest,
    );
  }

  if (options.commitMirrors !== true) {
    ensureMirrorGitignore(projectRoot, targets);
  }

  const legacyFlatFiles = findLegacyFlatFiles(projectRoot).map((path) => toRelativeProjectPath(projectRoot, path));

  const conflictNotes = conflicts.map(
    (conflict) =>
      `Preserved skill paths for '${conflict.slug}': ${conflict.paths.map((item) => `${item.path} (${item.reason})`).join(', ')}. ` +
      `Back up or reconcile local changes; to replace this package and its mirrors with the server state, run ` +
      `'agentteams skill download --id ${conflict.skillId} --force'. To replace ALL packages (including v1 migration), ` +
      `run 'agentteams skill download --force --all'. Symlinks must be resolved manually.`,
  );

  return {
    message:
      `Downloaded ${written.length} skill package(s); removed ${removed.length}; preserved ${conflicts.length} due to conflicts.` +
      (conflictNotes.length > 0 ? `\n${conflictNotes.join('\n')}` : ''),
    conflictNotes,
    downloaded: written,
    conflicts,
    removed,
    mirrorTargets: targets,
    manifestPath: `.agentteams/skills.manifest.json`,
    ...(legacyFlatFiles.length > 0
      ? {
          legacyFlatFiles,
          warning:
            `Legacy flat skill files are still present: ${legacyFlatFiles.join(', ')}. ` +
            `They are no longer read. Remove them once the matching skill package exists.`,
        }
      : {}),
  };
};

const skillStatus = async (
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  options: SkillOptions,
) => {
  const projectRoot = projectRootOf(options);
  const manifest = readSkillManifest(projectRoot);
  const remote = await fetchAllSkills(apiUrl, projectId, headers);

  const localBySlug = new Map(manifest.entries.map((entry) => [entry.slug, entry]));
  const changes: { slug: string; type: 'new' | 'updated' | 'deleted' }[] = [];

  for (const skill of remote) {
    const local = localBySlug.get(skill.slug);
    if (!local) {
      changes.push({ slug: skill.slug, type: 'new' });
      continue;
    }
    if (local.version !== skill.version) {
      changes.push({ slug: skill.slug, type: 'updated' });
    }
    localBySlug.delete(skill.slug);
  }

  for (const [slug] of localBySlug) {
    changes.push({ slug, type: 'deleted' });
  }

  // 원격·매니페스트 어디에도 없는 로컬 패키지. `changes`와 섞지 않는다 — 이건 다운로드로 해결되는
  // 드리프트가 아니라 `skill create --apply`를 안 한 상태이고, `updateAvailable`을 켜면
  // `session sync`가 받을 게 없는데도 download를 부르게 된다.
  const manifestSlugs = new Set(manifest.entries.map((entry) => entry.slug));
  const unregistered = findUnregisteredSkillSlugs(
    projectRoot,
    new Set([...manifestSlugs, ...remote.map((s) => s.slug)]),
  );

  return {
    updateAvailable: changes.length > 0,
    changes,
    ...(unregistered.length > 0 ? { unregistered } : {}),
    summary: [
      changes.length === 0 ? '✓ Skills up to date' : `${changes.length} skill change(s) available`,
      unregistered.length > 0
        ? `${unregistered.length} local package(s) not registered — run 'agentteams skill create --dir .agentteams/skills/<slug> --apply'`
        : null,
    ]
      .filter(Boolean)
      .join('; '),
  };
};

export async function executeSkillCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: SkillOptions = {},
): Promise<any> {
  switch (action) {
    case 'list':
      return listSkills(apiUrl, projectId, headers, {
        ...(options.page ? { page: Number(options.page) } : {}),
        ...(options.pageSize ? { pageSize: Number(options.pageSize) } : {}),
        ...(options.search ? { search: String(options.search) } : {}),
      });

    case 'show':
      return getSkill(apiUrl, projectId, headers, requireId(options));

    case 'download': {
      const lockPath = join(projectRootOf(options), '.agentteams', 'skills.sync.lock');
      if (options.releaseLock === true) {
        if (options.force || options.all || options.id)
          throw new SkillPackageError('--release-lock must be used on its own.');
        if (!existsSync(lockPath)) return { released: false, message: 'No skill sync lock exists.' };
        const contents = readFileSync(lockPath, 'utf8');
        let pid: number | undefined;
        try {
          const record = JSON.parse(contents);
          if (Number.isInteger(record.pid) && record.pid > 0) pid = record.pid;
        } catch {
          // 구버전의 빈 잠금도 명시적 복구 명령으로 해제할 수 있다.
        }
        if (pid !== undefined) {
          let alive = true;
          try {
            process.kill(pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            alive = false;
          }
          if (alive) throw new SkillPackageError(`Skill sync process ${pid} is still running; keep its lock.`);
        }
        rmSync(lockPath);
        return {
          released: true,
          message: 'Skill sync lock released. Check retained recovery directories before downloading again.',
        };
      }
      mkdirSync(dirname(lockPath), { recursive: true });
      let lock: number;
      try {
        lock = openSync(lockPath, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new SkillPackageError(
            'Another skill download or recovery is pending. After checking the stopped process and recovery directories, run agentteams skill download --release-lock.',
          );
        }
        throw error;
      }
      try {
        writeFileSync(lock, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        return await skillDownload(apiUrl, projectId, headers, options);
      } finally {
        closeSync(lock);
        rmSync(lockPath, { force: true });
      }
    }

    case 'status':
      return skillStatus(apiUrl, projectId, headers, options);

    case 'create': {
      const packageDir = resolvePackageDir(options);
      const files = collectSkillPackageFiles(packageDir);
      const slug = slugFor(options, packageDir);

      if (options.apply !== true) {
        return {
          dryRun: true,
          slug,
          files: files.map((file) => file.relativePath),
          hint: 'Re-run with --apply to create the skill on the server.',
        };
      }

      return createSkill(apiUrl, projectId, headers, {
        slug,
        files,
        ...(options.repositoryId ? { repositoryId: String(options.repositoryId) } : {}),
        ...(options.scope ? { scope: String(options.scope) } : {}),
      });
    }

    case 'update': {
      const skillId = requireId(options);
      const packageDir = resolvePackageDir(options);
      const files = collectSkillPackageFiles(packageDir);

      const current = await getSkill(apiUrl, projectId, headers, skillId);
      const updatedAt = current?.data?.updatedAt;
      if (typeof updatedAt !== 'string') {
        throw new Error('Could not read the current skill version for optimistic locking');
      }

      if (options.apply !== true) {
        return {
          dryRun: true,
          skillId,
          files: files.map((file) => file.relativePath),
          hint: 'Re-run with --apply to update the skill on the server.',
        };
      }

      return updateSkill(apiUrl, projectId, headers, skillId, {
        files,
        updatedAt,
        ...(options.scope ? { scope: String(options.scope) } : {}),
      });
    }

    case 'delete': {
      const skillId = requireId(options);
      if (options.apply !== true) {
        return { dryRun: true, skillId, hint: 'Re-run with --apply to delete the skill on the server.' };
      }
      return deleteSkill(apiUrl, projectId, headers, skillId);
    }

    default:
      throw new Error(`Unknown skill action: ${action}`);
  }
}

export { SKILL_ENTRY_FILE, SKILL_PACKAGE_DIR, SkillPackageError, validateSkillPackageFiles };
