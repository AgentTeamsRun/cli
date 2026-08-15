import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createSkill, deleteSkill, downloadSkill, getSkill, listSkills, updateSkill } from '../api/skill.js';
import {
  SKILL_ENTRY_FILE,
  SKILL_PACKAGE_DIR,
  SkillPackageError,
  type SkillDownloadManifestV1,
  type SkillManifestEntry,
  type SkillMirrorTarget,
  type SkillPackageFile,
  collectSkillPackageFiles,
  detectSkillMirrorTargets,
  ensureMirrorGitignore,
  mirrorDirFor,
  parseSkillTargetsOption,
  readSkillManifest,
  removeManifestPaths,
  skillPackageRoot,
  validateSkillPackageFiles,
  writePackageAtomically,
  writeSkillManifest,
} from '../utils/skillPackage.js';

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
 * mirror 대상 결정. `--skill-targets`가 있으면 그것만 쓰고, 없으면 마커가 실재하는 클라이언트만
 * 고른다. 사용자 홈 아래 경로는 어떤 경우에도 대상이 아니다 — 전부 프로젝트 로컬이다.
 */
const resolveMirrorTargets = (projectRoot: string, options: SkillOptions): SkillMirrorTarget[] => {
  const explicit = parseSkillTargetsOption(options.skillTargets);
  return explicit ?? detectSkillMirrorTargets(projectRoot);
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

const writeMirrors = (
  projectRoot: string,
  slug: string,
  files: SkillPackageFile[],
  targets: SkillMirrorTarget[],
): string[] => {
  const written: string[] = [];
  for (const target of targets) {
    const mirrorDir = mirrorDirFor(projectRoot, target, slug);
    writePackageAtomically(mirrorDir, files);
    for (const file of files) {
      written.push(toRelativeProjectPath(projectRoot, join(mirrorDir, ...file.relativePath.split('/'))));
    }
  }
  return written;
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

  const skills = await fetchAllSkills(apiUrl, projectId, headers);

  const previous = readSkillManifest(projectRoot);
  const entries: SkillManifestEntry[] = [];
  const written: { slug: string; version: string }[] = [];

  for (const summary of skills) {
    const payload = await downloadSkill(apiUrl, projectId, headers, summary.id);
    const files: SkillPackageFile[] = (payload?.data?.files ?? []).map((file: any) => ({
      relativePath: String(file.relativePath),
      content: String(file.content ?? ''),
    }));

    // 서버 응답도 계약을 만족하는지 확인한 뒤에야 디스크에 손을 댄다. 검증 실패 시 기존
    // 패키지는 그대로 남는다(아직 아무것도 지우지 않았다).
    validateSkillPackageFiles(files);

    writePackageAtomically(join(skillPackageRoot(projectRoot), summary.slug), files);
    const mirrorPaths = writeMirrors(projectRoot, summary.slug, files, targets);

    entries.push({ skillId: summary.id, slug: summary.slug, version: summary.version, mirrorPaths });
    written.push({ slug: summary.slug, version: summary.version });
  }

  // 대상에서 빠진 mirror를 지운다. slug가 살아 있어도 `.claude` 마커를 지웠거나
  // `--skill-targets`를 줄였으면 이전 사본이 남는다 — 그 파일은 manifest에서 소유권 기록만
  // 사라져 다음 실행부터는 CLI가 안전하게 정리할 수도 없다. 그래서 manifest를 교체하기 전에
  // 이전 mirrorPaths와 새 mirrorPaths의 차집합을 지운다.
  const newPathsBySlug = new Map(entries.map((entry) => [entry.slug, new Set(entry.mirrorPaths)]));
  for (const stale of previous.entries) {
    const currentPaths = newPathsBySlug.get(stale.slug);
    if (!currentPaths) {
      continue;
    }
    const droppedPaths = stale.mirrorPaths.filter((path) => !currentPaths.has(path));
    if (droppedPaths.length > 0) {
      removeManifestPaths(projectRoot, droppedPaths);
    }
  }

  // 서버에서 사라진 스킬의 로컬 흔적을 지운다. manifest에 기록된 경로만 건드리므로, 사용자가
  // mirror 디렉터리에 따로 둔 파일은 남는다.
  const liveSlugs = new Set(entries.map((entry) => entry.slug));
  const removed: string[] = [];
  for (const stale of previous.entries) {
    if (liveSlugs.has(stale.slug)) {
      continue;
    }
    removeManifestPaths(projectRoot, stale.mirrorPaths);
    removeManifestPaths(projectRoot, [
      toRelativeProjectPath(projectRoot, join(skillPackageRoot(projectRoot), stale.slug)),
    ]);
    removed.push(stale.slug);
  }

  const manifest: SkillDownloadManifestV1 = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries,
  };
  writeSkillManifest(projectRoot, manifest);

  if (options.commitMirrors !== true) {
    ensureMirrorGitignore(projectRoot, targets);
  }

  const legacyFlatFiles = findLegacyFlatFiles(projectRoot).map((path) => toRelativeProjectPath(projectRoot, path));

  return {
    downloaded: written,
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

  return {
    updateAvailable: changes.length > 0,
    changes,
    summary: changes.length === 0 ? '✓ Skills up to date' : `${changes.length} skill change(s) available`,
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

    case 'download':
      return skillDownload(apiUrl, projectId, headers, options);

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
