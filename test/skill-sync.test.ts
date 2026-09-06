import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findSkillConflicts, readSkillTree, skillEntryRoots, skillFileHashes } from '../src/utils/skillSync.js';
import { readSkillManifest, writeSkillManifest } from '../src/utils/skillPackage.js';

let projectRoot: string;
const canonical = '.agentteams/skills/example';
const mirror = '.agents/skills/example';
const files = [
  { relativePath: 'SKILL.md', content: '원본' },
  { relativePath: 'references/note.md', content: '참고' },
];
const baseline = skillFileHashes([canonical, mirror], files);
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(projectRoot, path)), { recursive: true });
  writeFileSync(join(projectRoot, path), content);
};

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-sync-'));
  for (const root of [canonical, mirror]) {
    for (const file of files) write(`${root}/${file.relativePath}`, file.content);
  }
});
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

describe('배포 기준과 로컬 변경 계약', () => {
  it.each([canonical, mirror])('%s의 수정·추가·삭제를 모두 검출한다', (root) => {
    expect(findSkillConflicts(root, readSkillTree(projectRoot, root), baseline)).toEqual([]);
    write(`${root}/SKILL.md`, '사용자 수정');
    write(`${root}/local.bin`, '로컬 추가');
    rmSync(join(projectRoot, root, 'references/note.md'));
    expect(findSkillConflicts(root, readSkillTree(projectRoot, root), baseline)).toEqual(
      expect.arrayContaining([
        { path: `${root}/SKILL.md`, reason: 'modified' },
        { path: `${root}/local.bin`, reason: 'added' },
        { path: `${root}/references/note.md`, reason: 'deleted' },
      ]),
    );
  });

  it('기준이 없는 기존 파일은 서버와 같아도 원본으로 추정하지 않는다', () => {
    expect(findSkillConflicts(canonical, readSkillTree(projectRoot, canonical), undefined)).toContainEqual({
      path: `${canonical}/SKILL.md`,
      reason: 'unknown',
    });
    expect(findSkillConflicts('.agentteams/skills/new', {}, undefined)).toEqual([]);
  });

  it('전체 패키지 로컬 삭제와 빈 디렉터리 추가도 보존 대상이다', () => {
    rmSync(join(projectRoot, canonical), { recursive: true });
    expect(findSkillConflicts(canonical, readSkillTree(projectRoot, canonical), baseline)).toHaveLength(2);
    mkdirSync(join(projectRoot, mirror, 'empty'));
    expect(findSkillConflicts(mirror, readSkillTree(projectRoot, mirror), baseline)).toContainEqual({
      path: `${mirror}/empty`,
      reason: 'added',
    });
  });

  it('OS 자동 생성 파일은 무시하고 사용자 파일은 계속 보호한다', () => {
    for (const name of ['.DS_Store', '._note', 'Thumbs.db']) write(`${canonical}/${name}`, 'OS');
    expect(findSkillConflicts(canonical, readSkillTree(projectRoot, canonical), baseline)).toEqual([]);
    write(`${canonical}/user.bin`, '사용자');
    expect(findSkillConflicts(canonical, readSkillTree(projectRoot, canonical), baseline)).toEqual([
      { path: `${canonical}/user.bin`, reason: 'added' },
    ]);
  });

  it('심볼릭 링크의 내용을 읽지 않는다', () => {
    symlinkSync(join(projectRoot, 'outside'), join(projectRoot, canonical, 'link'));
    expect(findSkillConflicts(canonical, readSkillTree(projectRoot, canonical), baseline)).toContainEqual({
      path: `${canonical}/link`,
      reason: 'unsafe',
    });
  });

  it.each([1, 2] as const)('manifest v%s를 읽으며 기준 해시를 임의로 생성하지 않는다', (version) => {
    const entry = { skillId: 'id', slug: 'example', version: 'v1', mirrorPaths: [`${mirror}/SKILL.md`] };
    writeSkillManifest(projectRoot, { version, generatedAt: 'fixture', entries: [entry] });
    expect(readSkillManifest(projectRoot).entries[0]).toEqual(entry);
    expect(skillEntryRoots(entry)).toEqual([canonical, mirror]);
  });
});
