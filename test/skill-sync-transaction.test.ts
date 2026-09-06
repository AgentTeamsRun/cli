import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rename = jest.fn(fs.renameSync);
const write = jest.fn(fs.writeFileSync);
jest.unstable_mockModule('node:fs', () => ({ ...fs, renameSync: rename, writeFileSync: write }));
const { commitSkillChanges, readSkillTree } = await import('../src/utils/skillSync.js');

let projectRoot: string;
const roots = ['.agentteams/skills/example', '.agents/skills/example'];
const manifest = '.agentteams/skills.manifest.json';
const newFiles = [{ relativePath: 'SKILL.md', content: '새 원본' }];
const changes = () => roots.map((root) => ({ root, files: newFiles, before: readSkillTree(projectRoot, root) }));

beforeEach(() => {
  projectRoot = fs.mkdtempSync(join(tmpdir(), 'skill-transaction-'));
  for (const root of roots) {
    fs.mkdirSync(join(projectRoot, root), { recursive: true });
    fs.writeFileSync(join(projectRoot, root, 'SKILL.md'), '기존 원본');
  }
  fs.writeFileSync(join(projectRoot, manifest), '기존 manifest');
  rename.mockReset().mockImplementation(fs.renameSync);
  write.mockReset().mockImplementation(fs.writeFileSync);
});
afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

const expectOriginal = () => {
  for (const root of roots) expect(fs.readFileSync(join(projectRoot, root, 'SKILL.md'), 'utf8')).toBe('기존 원본');
  expect(fs.readFileSync(join(projectRoot, manifest), 'utf8')).toBe('기존 manifest');
};

describe('스킬 교체와 manifest의 복구', () => {
  it.each([2, 4, 6])('%s번째 rename 실패 시 이미 적용한 원본·미러·manifest를 복구하고 재시도한다', (failAt) => {
    let calls = 0;
    rename.mockImplementation((from, to) => {
      calls += 1;
      if (calls === failAt) throw new Error('주입한 rename 실패');
      fs.renameSync(from, to);
    });
    expect(() => commitSkillChanges(projectRoot, changes(), '새 manifest', '기존 manifest')).toThrow('주입한');
    expectOriginal();
    rename.mockImplementation(fs.renameSync);
    commitSkillChanges(projectRoot, changes(), '새 manifest', '기존 manifest');
    expect(fs.readFileSync(join(projectRoot, manifest), 'utf8')).toBe('새 manifest');
  });

  it('stage 쓰기 실패 시 원본을 손대지 않는다', () => {
    write.mockImplementation(() => {
      throw new Error('주입한 쓰기 실패');
    });
    expect(() => commitSkillChanges(projectRoot, changes(), '새 manifest', '기존 manifest')).toThrow('주입한');
    expectOriginal();
  });

  it('stage 도중 사용자가 저장한 수정은 commit 직전 검사로 보존한다', () => {
    let edited = false;
    write.mockImplementation((...args) => {
      if (!edited) {
        edited = true;
        fs.writeFileSync(join(projectRoot, roots[1], 'SKILL.md'), '동시 편집');
      }
      fs.writeFileSync(...args);
    });
    expect(() => commitSkillChanges(projectRoot, changes(), '새 manifest', '기존 manifest')).toThrow('changed during');
    expect(fs.readFileSync(join(projectRoot, roots[1], 'SKILL.md'), 'utf8')).toBe('동시 편집');
    expect(fs.readFileSync(join(projectRoot, manifest), 'utf8')).toBe('기존 manifest');
    expect(rename).not.toHaveBeenCalled();
  });

  it('정리 삭제 뒤 manifest 교체가 실패해도 삭제한 디렉터리를 되돌린다', () => {
    rename.mockImplementation((from, to) => {
      if (to === join(projectRoot, manifest)) throw new Error('manifest 실패');
      fs.renameSync(from, to);
    });
    // 복구 rename은 허용한다.
    rename
      .mockImplementationOnce(fs.renameSync)
      .mockImplementationOnce(fs.renameSync)
      .mockImplementationOnce(fs.renameSync)
      .mockImplementationOnce(() => {
        throw new Error('manifest 실패');
      })
      .mockImplementation(fs.renameSync);
    expect(() =>
      commitSkillChanges(
        projectRoot,
        changes().map((change) => ({ ...change, files: null })),
        '새 manifest',
        '기존 manifest',
      ),
    ).toThrow();
    expectOriginal();
  });
});
