import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as convention from '../src/commands/convention.js';
import * as config from '../src/utils/config.js';

jest.unstable_mockModule('../src/commands/convention.js', () => ({
  ...convention,
  conventionStatus: async () => ({
    conventionUpdateAvailable: false,
    platformGuidesChanged: false,
    cliUpdateAvailable: false,
  }),
  conventionDownload: async () => ({ message: 'Convention sync completed.' }),
}));
jest.unstable_mockModule('../src/utils/config.js', () => ({
  ...config,
  loadConfigWithCredential: async () => ({
    projectId: 'project',
    teamId: 'team',
    apiUrl: 'https://example.test',
    apiKey: 'fixture',
  }),
}));
let version = 'v1';
let healthyVersion = 'v1';
let downloadedIds: string[] = [];
jest.unstable_mockModule('../src/api/skill.js', () => ({
  listSkills: async () => ({
    data: [
      { id: 'skill-id', slug: 'example', version },
      { id: 'healthy-id', slug: 'healthy', version: healthyVersion },
    ],
    meta: { totalPages: 1 },
  }),
  downloadSkill: async (_api: string, _project: string, _headers: unknown, id: string) => {
    downloadedIds.push(id);
    return { data: { files: [{ relativePath: 'SKILL.md', content: id === 'skill-id' ? version : '정상' }] } };
  },
  getSkill: jest.fn(),
  createSkill: jest.fn(),
  updateSkill: jest.fn(),
  deleteSkill: jest.fn(),
  requestSkillAssetUploadUrls: jest.fn(),
  putSkillAssetBytes: jest.fn(),
  fetchSkillAssetBytes: jest.fn(),
  // 공유 커맨드(share/unshare/shares/browse/install)용. 이 파일의 시나리오는 호출하지 않는다.
  createSkillShare: jest.fn(),
  revokeSkillShare: jest.fn(),
  listSkillShares: jest.fn(),
  listSkillInstalls: jest.fn(),
  listSharedSkills: jest.fn(),
  getSharedSkill: jest.fn(),
  installSharedSkill: jest.fn(),
  getPublicSharedSkill: jest.fn(),
  installSharedSkillByToken: jest.fn(),
}));
const { executeSkillCommand } = await import('../src/commands/skill.js');
const { sessionSync } = await import('../src/commands/session.js');
const { executeSyncCommand } = await import('../src/commands/conventionRouter.js');
let projectRoot: string;
let originalCwd: string;

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-entrypoints-'));
  originalCwd = process.cwd();
  mkdirSync(join(projectRoot, '.agentteams'));
  writeFileSync(join(projectRoot, '.agentteams/config.json'), JSON.stringify({ projectId: 'project', teamId: 'team' }));
  version = 'v1';
  healthyVersion = 'v1';
  await executeSkillCommand('https://example.test', 'project', {}, 'download', { cwd: projectRoot });
  writeFileSync(join(projectRoot, '.agentteams/skills/example/SKILL.md'), '비공개 편집');
  version = 'v2';
  downloadedIds = [];
  process.chdir(projectRoot);
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('동기화 진입점의 기본 보존', () => {
  it('session sync는 충돌 안내를 slug 목록 한 줄로 요약한다', async () => {
    const result = await sessionSync({ cwd: projectRoot });
    expect(result.synced.skills).toBe(false);
    expect(result.skillConflicts).toBe(1);
    expect(result.summary).toContain('1 skill package(s) preserved');
    const conflictNotes = result.notes.filter((note) => note.includes('kept local changes'));
    expect(conflictNotes).toHaveLength(1);
    expect(conflictNotes[0]).toContain('example');
    expect(conflictNotes[0]).toContain('skill download --force --all');
    // 패키지별 상세(보존 경로)는 요약 줄에 들어가지 않는다 — 상세는 skill download 출력에서 본다.
    expect(result.notes.join('\n')).not.toContain('.agentteams/skills/example/SKILL.md');
    expect(JSON.stringify(result)).not.toContain('비공개 편집');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/example/SKILL.md'), 'utf8')).toBe('비공개 편집');
  });

  it('충돌이 여러 건이어도 notes의 충돌 안내는 한 줄이다', async () => {
    writeFileSync(join(projectRoot, '.agentteams/skills/healthy/SKILL.md'), '로컬 편집');
    healthyVersion = 'v2';

    const result = await sessionSync({ cwd: projectRoot });
    expect(result.skillConflicts).toBe(2);
    expect(result.summary).toContain('2 skill package(s) preserved');
    const conflictNotes = result.notes.filter((note) => note.includes('kept local changes'));
    expect(conflictNotes).toHaveLength(1);
    expect(conflictNotes[0]).toContain('example');
    expect(conflictNotes[0]).toContain('healthy');
    expect(conflictNotes[0]).toContain('skill download --force --all');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/healthy/SKILL.md'), 'utf8')).toBe('로컬 편집');
  });

  it('convention router의 sync도 암묵적으로 강제하지 않는다', async () => {
    const result = await executeSyncCommand('download', { cwd: projectRoot, force: true });
    expect(result.skills.conflicts).toHaveLength(1);
    expect(result.skills.message).toContain('preserved 1');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/example/SKILL.md'), 'utf8')).toBe('비공개 편집');
  });
  it('충돌한 다음 세션에도 최신 패키지의 본문은 다시 받지 않는다', async () => {
    await sessionSync({ cwd: projectRoot });
    const again = await sessionSync({ cwd: projectRoot });
    expect(downloadedIds).toEqual(['skill-id', 'skill-id']);
    expect(again.skillConflicts).toBe(1);
    expect(again.summary).toContain('1 skill package(s) preserved');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/healthy/SKILL.md'), 'utf8')).toBe('정상');
    // 수동 다운로드는 같은 버전도 다시 검사하므로 사용자가 파일을 정리한 뒤 재시도할 수 있다.
    await executeSkillCommand('https://example.test', 'project', {}, 'download', { cwd: projectRoot });
    expect(downloadedIds).toContain('healthy-id');
  });
});
