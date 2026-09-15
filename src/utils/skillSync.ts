import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  isOsJunkFileName,
  SkillPackageError,
  type SkillManifestEntry,
  type SkillWritableFile,
} from './skillPackage.js';

export type SkillConflict = { path: string; reason: 'modified' | 'added' | 'deleted' | 'unknown' | 'unsafe' };
export type SkillTree = Record<string, string>;

export const hashSkillFile = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');

export const skillFileHashes = (roots: string[], files: SkillWritableFile[]): Record<string, string> =>
  Object.fromEntries(
    roots.flatMap((root) => files.map((file) => [`${root}/${file.relativePath}`, hashSkillFile(file.content)])),
  );

export const assertSkillSlug = (slug: string): void => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(slug)) throw new SkillPackageError(`Invalid skill slug: ${slug}`);
};

export const skillEntryRoots = (entry: SkillManifestEntry): string[] => {
  assertSkillSlug(entry.slug);
  const roots = new Set([`.agentteams/skills/${entry.slug}`]);
  for (const path of entry.mirrorPaths) {
    const parts = path.split('/');
    if (
      !['.agents', '.claude', '.github'].includes(parts[0]) ||
      parts[1] !== 'skills' ||
      parts[2] !== entry.slug ||
      parts.length < 4 ||
      parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
    ) {
      throw new SkillPackageError(`Invalid skill mirror path: ${path}`);
    }
    roots.add(parts.slice(0, 3).join('/'));
  }
  return [...roots];
};

const statOrMissing = (path: string) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

/** 링크를 따라가지 않고 바이너리·빈 디렉터리까지 검사하되 OS 자동 생성 파일은 제외한다. 업로드 필터를 재사용하면 로컬 추가가 누락된다. */
export const readSkillTree = (projectRoot: string, root: string): SkillTree => {
  const tree: SkillTree = {};
  const parts = root.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join('/');
    const stat = statOrMissing(join(projectRoot, ancestor));
    if (stat && !stat.isDirectory()) return { [ancestor]: 'unsafe' };
  }
  const walk = (path: string): void => {
    const absolute = join(projectRoot, path);
    const stat = statOrMissing(absolute);
    if (!stat) return;
    if (stat.isDirectory()) {
      tree[path] = 'directory';
      for (const name of readdirSync(absolute).sort()) {
        if (!isOsJunkFileName(name)) walk(`${path}/${name}`);
      }
    } else {
      tree[path] = stat.isFile() ? hashSkillFile(readFileSync(absolute)) : 'unsafe';
    }
  };
  walk(root);
  return tree;
};

export const findSkillConflicts = (
  root: string,
  current: SkillTree,
  baseline: Record<string, string> | undefined,
): SkillConflict[] => {
  const expected = Object.fromEntries(Object.entries(baseline ?? {}).filter(([path]) => path.startsWith(`${root}/`)));
  const conflicts: SkillConflict[] = [];
  for (const [path, value] of Object.entries(current)) {
    if (value === 'unsafe') conflicts.push({ path, reason: 'unsafe' });
    else if (!baseline) conflicts.push({ path, reason: 'unknown' });
    else if (value === 'directory') {
      if (!Object.keys(expected).some((file) => file.startsWith(`${path}/`))) conflicts.push({ path, reason: 'added' });
    } else if (!Object.hasOwn(expected, path)) conflicts.push({ path, reason: 'added' });
    else if (expected[path] !== value) conflicts.push({ path, reason: 'modified' });
  }
  for (const path of Object.keys(expected)) {
    if (!Object.hasOwn(current, path)) conflicts.push({ path, reason: 'deleted' });
  }
  return conflicts;
};

export type SkillTreeChange = { root: string; files: SkillWritableFile[] | null; before: SkillTree };

/** 준비한 모든 경로와 manifest를 함께 적용한다. 복구 실패 시 백업은 지우지 않는다. */
export const commitSkillChanges = (
  projectRoot: string,
  changes: SkillTreeChange[],
  manifestContent: string,
  previousManifest: string | undefined,
): void => {
  const manifestRoot = '.agentteams/skills.manifest.json';
  const manifestPath = join(projectRoot, manifestRoot);
  const staged: { target: string; temp: string; backup: string; next: string; moved: boolean; installed: boolean }[] =
    [];
  let restored = true;
  try {
    for (const change of changes) {
      const target = join(projectRoot, change.root);
      mkdirSync(dirname(target), { recursive: true });
      const temp = mkdtempSync(`${target}.sync-`);
      const state = {
        target,
        temp,
        backup: join(temp, 'previous'),
        next: join(temp, 'next'),
        moved: false,
        installed: false,
      };
      staged.push(state);
      if (change.files !== null) {
        mkdirSync(state.next);
        for (const file of change.files) {
          const path = join(state.next, file.relativePath);
          mkdirSync(dirname(path), { recursive: true });
          // 자산은 원본 바이트 그대로 쓴다 — UTF-8로 기록하면 해시가 깨진다.
          if (typeof file.content === 'string') {
            writeFileSync(path, file.content, 'utf8');
          } else {
            writeFileSync(path, file.content);
          }
        }
      }
    }
    mkdirSync(dirname(manifestPath), { recursive: true });
    const temp = mkdtempSync(`${manifestPath}.sync-`);
    const manifestState = {
      target: manifestPath,
      temp,
      backup: join(temp, 'previous'),
      next: join(temp, 'next'),
      moved: false,
      installed: false,
    };
    staged.push(manifestState);
    writeFileSync(manifestState.next, manifestContent, 'utf8');

    // stage 도중 에디터가 저장한 파일을 이전 검사 결과로 덮어쓰지 않는다. 강제 실행도 동일하다.
    for (const change of changes) {
      if (JSON.stringify(readSkillTree(projectRoot, change.root)) !== JSON.stringify(change.before)) {
        throw new SkillPackageError(
          `Skill files changed during download: ${change.root}. Retry after saving your work.`,
        );
      }
    }
    const currentManifest = statOrMissing(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined;
    if (currentManifest !== previousManifest)
      throw new SkillPackageError('Skill manifest changed during download. Retry.');

    for (const state of staged) {
      if (statOrMissing(state.target)) {
        renameSync(state.target, state.backup);
        state.moved = true;
      }
      if (statOrMissing(state.next)) {
        renameSync(state.next, state.target);
        state.installed = true;
      }
    }
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    for (const state of [...staged].reverse()) {
      try {
        if (state.installed) rmSync(state.target, { recursive: true, force: true });
        if (state.moved) renameSync(state.backup, state.target);
      } catch (recoveryError) {
        restored = false;
        recoveryErrors.push(recoveryError);
      }
    }
    if (!restored) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        `Skill rollback failed. Keep recovery directories: ${staged.map((state) => state.temp).join(', ')}`,
      );
    }
    throw error;
  } finally {
    if (restored) {
      for (const state of staged) rmSync(state.temp, { recursive: true, force: true });
    }
  }
};
