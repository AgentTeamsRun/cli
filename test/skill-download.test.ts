import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const entryContent = (slug: string, body = '# Skill\n') =>
  `---\nname: ${slug}\ndescription: >-\n  Does the thing.\n---\n\n${body}`;

const listSkills = jest.fn();
const downloadSkill = jest.fn();
const getSkill = jest.fn();
const createSkill = jest.fn();
const updateSkill = jest.fn();
const deleteSkill = jest.fn();

jest.unstable_mockModule('../src/api/skill.js', () => ({
  __esModule: true,
  listSkills,
  downloadSkill,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
}));

const { executeSkillCommand } = await import('../src/commands/skill.js');

let projectRoot = '';

const remoteSkill = (slug: string, files: { relativePath: string; content: string }[]) => ({
  id: `id-${slug}`,
  slug,
  version: `v-${slug}`,
  files,
});

const stubServer = (skills: ReturnType<typeof remoteSkill>[], pageSize = 100) => {
  // 서버는 페이지네이션한다. 첫 페이지만 보고 전체 상태로 간주하면 그 뒤 스킬이 stale로 지워진다.
  listSkills.mockImplementation((async (
    _apiUrl: string,
    _projectId: string,
    _headers: unknown,
    params?: { page?: number },
  ) => {
    const page = params?.page ?? 1;
    const totalPages = Math.max(1, Math.ceil(skills.length / pageSize));
    const slice = skills.slice((page - 1) * pageSize, page * pageSize);
    return {
      data: slice.map(({ id, slug, version }) => ({ id, slug, version })),
      meta: { total: skills.length, page, pageSize, totalPages },
    };
  }) as never);
  downloadSkill.mockImplementation((async (_apiUrl: string, _projectId: string, _headers: unknown, skillId: string) => {
    const match = skills.find((skill) => skill.id === skillId);
    if (!match) throw new Error(`unexpected skill ${skillId}`);
    return { data: { ...match } };
  }) as never);
};

const download = (options: Record<string, unknown> = {}) =>
  executeSkillCommand('https://api.example.test', 'project-1', {}, 'download', { cwd: projectRoot, ...options });

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-download-'));
  mkdirSync(join(projectRoot, '.agentteams'), { recursive: true });
});

afterEach(() => {
  jest.clearAllMocks();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('skill download mirror fan-out', () => {
  it('writes only .agents when no client marker exists', async () => {
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();

    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.agents', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude', 'skills'))).toBe(false);
    expect(existsSync(join(projectRoot, '.github', 'skills'))).toBe(false);
  });

  it('adds .claude and .github mirrors only when their markers exist', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    mkdirSync(join(projectRoot, '.github'), { recursive: true });
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();

    expect(existsSync(join(projectRoot, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.github', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('writes no mirror at all with --skill-targets=none', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download({ skillTargets: 'none' });

    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.agents', 'skills'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude', 'skills'))).toBe(false);
  });

  it('rejects an unknown --skill-targets value the same way --agent-files does', async () => {
    stubServer([]);
    await expect(download({ skillTargets: 'cursor' })).rejects.toThrow(/Unknown --skill-targets value/);
  });

  it('never touches paths under the user home directory', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    const homeSkillDirs = [join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')];
    const before = homeSkillDirs.map((dir) => (existsSync(dir) ? readdirSync(dir).sort() : null));

    await download();

    const after = homeSkillDirs.map((dir) => (existsSync(dir) ? readdirSync(dir).sort() : null));
    expect(after).toEqual(before);
  });
});

describe('skill download bookkeeping', () => {
  it('records mirror paths in its own manifest and leaves conventions.manifest.json alone', async () => {
    const conventionManifest = join(projectRoot, '.agentteams', 'conventions.manifest.json');
    writeFileSync(conventionManifest, JSON.stringify({ version: 1, entries: [] }), 'utf-8');
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();

    const manifest = JSON.parse(readFileSync(join(projectRoot, '.agentteams', 'skills.manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(1);
    expect(manifest.entries[0]).toMatchObject({ skillId: 'id-my-skill', slug: 'my-skill', version: 'v-my-skill' });
    expect(manifest.entries[0].mirrorPaths).toContain('.agents/skills/my-skill/SKILL.md');
    expect(JSON.parse(readFileSync(conventionManifest, 'utf-8'))).toEqual({ version: 1, entries: [] });
  });

  it('cleans up mirrors it recorded when a skill disappears, and keeps user files', async () => {
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);
    await download();

    const mirrorDir = join(projectRoot, '.agents', 'skills', 'my-skill');
    writeFileSync(join(mirrorDir, 'user-note.md'), 'mine', 'utf-8');

    stubServer([]);
    const result = (await download()) as { removed: string[] };

    expect(result.removed).toEqual(['my-skill']);
    expect(existsSync(join(mirrorDir, 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(mirrorDir, 'user-note.md'), 'utf-8')).toBe('mine');
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill'))).toBe(false);
  });

  it('adds mirror directories to .gitignore unless --commit-mirrors is given', async () => {
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();
    expect(readFileSync(join(projectRoot, '.gitignore'), 'utf-8')).toContain('.agents/skills/');

    rmSync(join(projectRoot, '.gitignore'));
    await download({ commitMirrors: true });
    expect(existsSync(join(projectRoot, '.gitignore'))).toBe(false);
  });

  it('warns about legacy flat skill files without deleting them', async () => {
    const legacyFile = join(projectRoot, '.agentteams', 'skills', 'dev-cli.md');
    mkdirSync(join(projectRoot, '.agentteams', 'skills'), { recursive: true });
    writeFileSync(legacyFile, '# legacy', 'utf-8');
    stubServer([remoteSkill('dev-cli', [{ relativePath: 'SKILL.md', content: entryContent('dev-cli') }])]);

    const result = (await download()) as { legacyFlatFiles?: string[]; warning?: string };

    expect(result.legacyFlatFiles).toEqual(['.agentteams/skills/dev-cli.md']);
    expect(result.warning).toMatch(/no longer read/);
    expect(readFileSync(legacyFile, 'utf-8')).toBe('# legacy');
  });

  it('keeps the existing package byte-for-byte when the server returns an invalid package', async () => {
    stubServer([
      remoteSkill('my-skill', [
        { relativePath: 'SKILL.md', content: entryContent('my-skill') },
        { relativePath: 'references/keep.md', content: 'original' },
      ]),
    ]);
    await download();

    const packageDir = join(projectRoot, '.agentteams', 'skills', 'my-skill');
    const before = readFileSync(join(packageDir, 'references', 'keep.md'), 'utf-8');

    // 두 번째 응답이 계약을 어긴다(패키지 루트 밖으로 나가는 경로).
    stubServer([
      remoteSkill('my-skill', [
        { relativePath: 'SKILL.md', content: entryContent('my-skill') },
        { relativePath: '../escape.md', content: 'boom' },
      ]),
    ]);

    await expect(download()).rejects.toThrow();

    expect(readFileSync(join(packageDir, 'references', 'keep.md'), 'utf-8')).toBe(before);
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'escape.md'))).toBe(false);
    const leftovers = readdirSync(join(projectRoot, '.agentteams', 'skills')).filter((name) =>
      name.includes('staging'),
    );
    expect(leftovers).toEqual([]);
  });
});

describe('skill create/update dry-run', () => {
  it('collects the package and does not call the API without --apply', async () => {
    const packageDir = join(projectRoot, 'pkg');
    mkdirSync(join(packageDir, 'references'), { recursive: true });
    writeFileSync(join(packageDir, 'SKILL.md'), entryContent('pkg'), 'utf-8');
    writeFileSync(join(packageDir, 'references', 'notes.md'), 'notes', 'utf-8');

    const result = (await executeSkillCommand('https://api.example.test', 'project-1', {}, 'create', {
      cwd: projectRoot,
      dir: packageDir,
      slug: 'pkg',
    })) as { dryRun: boolean; files: string[] };

    expect(result.dryRun).toBe(true);
    expect(result.files.sort()).toEqual(['SKILL.md', 'references/notes.md']);
    expect(createSkill).not.toHaveBeenCalled();
  });

  it('rejects an invalid package before calling the API', async () => {
    const packageDir = join(projectRoot, 'bad-pkg');
    mkdirSync(join(packageDir, 'assets'), { recursive: true });
    writeFileSync(join(packageDir, 'SKILL.md'), entryContent('bad-pkg'), 'utf-8');
    writeFileSync(join(packageDir, 'assets', 'logo.bin'), 'x', 'utf-8');

    await expect(
      executeSkillCommand('https://api.example.test', 'project-1', {}, 'create', {
        cwd: projectRoot,
        dir: packageDir,
        apply: true,
      }),
    ).rejects.toThrow(/must live under/);
    expect(createSkill).not.toHaveBeenCalled();
  });
});

describe('skill download pagination and mirror target changes', () => {
  it('101개 이상이어도 뒤 페이지 스킬을 지우지 않는다', async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      remoteSkill(`skill-${String(index).padStart(3, '0')}`, [
        { relativePath: 'SKILL.md', content: entryContent(`skill-${String(index).padStart(3, '0')}`) },
      ]),
    );
    stubServer(many);

    const result = (await download()) as { downloaded: unknown[]; removed: string[] };

    expect(result.downloaded).toHaveLength(101);
    expect(result.removed).toEqual([]);
    // 두 번째 페이지에 있던 스킬이 로컬에 남아 있어야 한다.
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'skill-100', 'SKILL.md'))).toBe(true);
  });

  it('mirror 대상을 줄이면 이전에 쓴 사본을 정리한다', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();
    expect(existsSync(join(projectRoot, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);

    // 마커를 지우면 다음 실행부터 .claude는 대상이 아니다.
    rmSync(join(projectRoot, '.claude', 'skills'), { recursive: true, force: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    await download();
    await download({ skillTargets: 'none' });

    expect(existsSync(join(projectRoot, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.agents', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
    // SSOT 패키지는 그대로다.
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });
});
