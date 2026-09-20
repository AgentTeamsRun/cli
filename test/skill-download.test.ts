import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
const requestSkillAssetUploadUrls = jest.fn();
const putSkillAssetBytes = jest.fn();
const fetchSkillAssetBytes = jest.fn();

jest.unstable_mockModule('../src/api/skill.js', () => ({
  __esModule: true,
  listSkills,
  downloadSkill,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  requestSkillAssetUploadUrls,
  putSkillAssetBytes,
  fetchSkillAssetBytes,
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

// mirror 대상은 마커 탐지에 더해 **현재 세션의 엔진**(`AGENTTEAMS_RUNNER_TYPE`)이 읽는 경로를
// 포함한다(`detectSkillMirrorTargets`). 그래서 이 변수가 상속된 환경 — 러너가 띄운 세션에서
// `pnpm test`를 돌릴 때 — 에서는 마커 없는 저장소에도 `.claude/skills`가 생겨 마커 탐지만
// 검증하는 케이스가 깨진다. CI에는 이 변수가 없어 드러나지 않는 형태의 누수라, 테스트가
// 자기 환경을 직접 고정한다.
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.AGENTTEAMS_RUNNER_TYPE;
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-download-'));
  mkdirSync(join(projectRoot, '.agentteams'), { recursive: true });
});

afterEach(() => {
  process.env = originalEnv;
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

  // 위 케이스가 러너 세션에서만 깨졌던 이유를 테스트로 고정한다. 이 경로는 버그가 아니라
  // 의도된 보정이므로(`RUNNER_REQUIRED_TARGETS`), 환경을 지우는 것으로 함께 사라지면 안 된다.
  it('adds the .claude mirror without a marker when the session runs as CLAUDE_CODE', async () => {
    process.env.AGENTTEAMS_RUNNER_TYPE = 'CLAUDE_CODE';
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);

    await download();

    expect(existsSync(join(projectRoot, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.github', 'skills'))).toBe(false);
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
    expect(manifest.version).toBe(2);
    expect(manifest.entries[0]).toMatchObject({ skillId: 'id-my-skill', slug: 'my-skill', version: 'v-my-skill' });
    expect(manifest.entries[0].mirrorPaths).toContain('.agents/skills/my-skill/SKILL.md');
    expect(JSON.parse(readFileSync(conventionManifest, 'utf-8'))).toEqual({ version: 1, entries: [] });
  });

  it('로컬 추가 파일이 있으면 서버 삭제에서도 패키지 전체를 보존한다', async () => {
    stubServer([remoteSkill('my-skill', [{ relativePath: 'SKILL.md', content: entryContent('my-skill') }])]);
    await download();

    const mirrorDir = join(projectRoot, '.agents', 'skills', 'my-skill');
    writeFileSync(join(mirrorDir, 'user-note.md'), 'mine', 'utf-8');

    stubServer([]);
    const result = (await download()) as { removed: string[] };

    expect(result.removed).toEqual([]);
    expect(existsSync(join(mirrorDir, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(mirrorDir, 'user-note.md'), 'utf-8')).toBe('mine');
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill'))).toBe(true);
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
    ).rejects.toThrow(/Unsupported skill asset type/);
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

    // 미수정 미러만 명시적으로 대상에서 제외한다.
    await download({ skillTargets: 'none' });

    expect(existsSync(join(projectRoot, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.agents', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);
    // SSOT 패키지는 그대로다.
    expect(existsSync(join(projectRoot, '.agentteams', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });
});

describe('로컬 변경 보호 통합', () => {
  const canonical = '.agentteams/skills/my-skill';
  const mirror = '.agents/skills/my-skill';
  const manifestPath = () => join(projectRoot, '.agentteams/skills.manifest.json');
  const initial = () =>
    remoteSkill('my-skill', [
      { relativePath: 'SKILL.md', content: entryContent('my-skill') },
      { relativePath: 'references/note.md', content: '원본 참고' },
    ]);
  const seed = async () => {
    stubServer([initial()]);
    await download();
  };

  it.each([canonical, mirror])('%s의 수정·추가·삭제가 업데이트와 manifest를 보존한다', async (root) => {
    await seed();
    const before = readFileSync(manifestPath(), 'utf8');
    writeFileSync(join(projectRoot, root, 'SKILL.md'), '비공개 로컬 수정');
    writeFileSync(join(projectRoot, root, 'local.bin'), Buffer.from([0, 255]));
    rmSync(join(projectRoot, root, 'references/note.md'));
    const remote = initial();
    remote.version = 'v2';
    remote.files[0].content = entryContent('my-skill', '서버 변경');
    stubServer([remote]);
    const result = await download();
    expect(result.downloaded).toEqual([]);
    expect(result.conflicts[0].paths).toEqual(
      expect.arrayContaining([
        { path: `${root}/SKILL.md`, reason: 'modified' },
        { path: `${root}/local.bin`, reason: 'added' },
        { path: `${root}/references/note.md`, reason: 'deleted' },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('비공개 로컬 수정');
    expect(readFileSync(manifestPath(), 'utf8')).toBe(before);
    expect(readFileSync(join(projectRoot, root, 'SKILL.md'), 'utf8')).toBe('비공개 로컬 수정');
    expect(existsSync(join(projectRoot, root, 'references/note.md'))).toBe(false);
  });

  it('원격 삭제·이름 변경·미러 축소도 수정된 미러가 있으면 보존한다', async () => {
    await seed();
    const before = readFileSync(manifestPath(), 'utf8');
    writeFileSync(join(projectRoot, mirror, 'SKILL.md'), '사용자 편집');
    stubServer([]);
    expect((await download()).removed).toEqual([]);
    const renamed = { ...initial(), slug: 'new-name' };
    stubServer([renamed]);
    expect((await download()).downloaded).toEqual([]);
    expect(existsSync(join(projectRoot, '.agentteams/skills/new-name'))).toBe(false);
    stubServer([initial()]);
    expect((await download({ skillTargets: 'none' })).downloaded).toEqual([]);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(before);
  });

  it('미수정 패키지는 이름 변경 후 삭제할 수 있다', async () => {
    await seed();
    stubServer([{ ...initial(), slug: 'new-name', version: 'v2' }]);
    expect((await download()).removed).toEqual(['my-skill']);
    expect(existsSync(join(projectRoot, canonical))).toBe(false);
    expect(existsSync(join(projectRoot, '.agentteams/skills/new-name/SKILL.md'))).toBe(true);
    stubServer([]);
    expect((await download()).removed).toEqual(['new-name']);
    expect(readSkillEntries()).toEqual([]);
  });

  const readSkillEntries = () => JSON.parse(readFileSync(manifestPath(), 'utf8')).entries;

  it('v1은 원본을 추정하지 않으며 다른 패키지 설치 후에도 기준 없이 유지한다', async () => {
    await seed();
    const manifest = JSON.parse(readFileSync(manifestPath(), 'utf8'));
    manifest.version = 1;
    delete manifest.entries[0].fileHashes;
    writeFileSync(manifestPath(), JSON.stringify(manifest));
    stubServer([initial(), remoteSkill('second', [{ relativePath: 'SKILL.md', content: entryContent('second') }])]);
    const result = await download();
    expect(result.downloaded.map((item: { slug: string }) => item.slug)).toEqual(['second']);
    expect(result.conflicts[0].paths.some((item: { reason: string }) => item.reason === 'unknown')).toBe(true);
    expect(readSkillEntries().find((entry: { slug: string }) => entry.slug === 'my-skill').fileHashes).toBeUndefined();
  });

  it('뒤 패키지 다운로드가 실패하면 앞 패키지와 manifest도 그대로다', async () => {
    await seed();
    const before = readFileSync(manifestPath(), 'utf8');
    const updated = initial();
    updated.files[0].content = entryContent('my-skill', '새 본문');
    stubServer([updated, remoteSkill('broken', [{ relativePath: '../escape', content: '실패' }])]);
    await expect(download()).rejects.toThrow();
    expect(readFileSync(join(projectRoot, canonical, 'SKILL.md'), 'utf8')).toBe(entryContent('my-skill'));
    expect(readFileSync(manifestPath(), 'utf8')).toBe(before);
    stubServer([updated]);
    expect((await download()).downloaded).toHaveLength(1);
  });
});

describe('명시적으로 선택한 강제 다운로드', () => {
  it('선택하지 않은 패키지와 서버 삭제 항목을 건드리지 않는다', async () => {
    const packages = ['first', 'second', 'deleted'].map((slug) =>
      remoteSkill(slug, [{ relativePath: 'SKILL.md', content: entryContent(slug) }]),
    );
    stubServer(packages);
    await download();
    for (const slug of ['first', 'second']) {
      writeFileSync(join(projectRoot, '.agentteams/skills', slug, 'SKILL.md'), '로컬 변경');
    }
    stubServer(packages.slice(0, 2));
    const result = await download({ id: 'id-first', force: true });
    expect(result.downloaded.map((item: { slug: string }) => item.slug)).toEqual(['first']);
    expect(result.removed).toEqual([]);
    expect(readFileSync(join(projectRoot, '.agentteams/skills/second/SKILL.md'), 'utf8')).toBe('로컬 변경');
    expect(existsSync(join(projectRoot, '.agentteams/skills/deleted/SKILL.md'))).toBe(true);
  });

  it('패키지 선택 없는 강제 실행은 거부한다', async () => {
    stubServer([]);
    await expect(download({ force: true })).rejects.toThrow('--force requires --id');
  });

  it('명시적 선택으로만 구형 manifest를 이행한다', async () => {
    stubServer([remoteSkill('legacy', [{ relativePath: 'SKILL.md', content: entryContent('legacy') }])]);
    await download();
    const path = join(projectRoot, '.agentteams/skills.manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.version = 1;
    delete manifest.entries[0].fileHashes;
    writeFileSync(path, JSON.stringify(manifest));
    const preserved = await download();
    expect(preserved.message).toContain('.agentteams/skills/legacy/SKILL.md');
    expect(preserved.message).toContain('agentteams skill download --id id-legacy --force');
    await download({ id: 'id-legacy', force: true });
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2);
    expect((await download()).conflicts).toEqual([]);
  });
});

describe('기존 패키지 소유권 경계', () => {
  it('선택한 ID와 다른 기존 소유자의 경로는 force로도 덮어쓰지 않는다', async () => {
    stubServer([remoteSkill('shared-slug', [{ relativePath: 'SKILL.md', content: '기존 원본' }])]);
    await download();
    const manifestPath = join(projectRoot, '.agentteams/skills.manifest.json');
    const before = readFileSync(manifestPath, 'utf8');
    stubServer([
      { ...remoteSkill('shared-slug', [{ relativePath: 'SKILL.md', content: '새 소유자' }]), id: 'different-id' },
    ]);
    expect((await download({ id: 'different-id', force: true })).conflicts[0].paths[0].reason).toBe('unsafe');
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(readFileSync(join(projectRoot, '.agentteams/skills/shared-slug/SKILL.md'), 'utf8')).toBe('기존 원본');
  });
});

describe('잘못된 패키지 소유권 격리', () => {
  it.each(['slug', 'mirror', 'duplicate'])('%s 오류가 다른 패키지를 차단하지 않는다', async (kind) => {
    const packages = ['first', 'second', 'healthy'].map((slug) =>
      remoteSkill(slug, [{ relativePath: 'SKILL.md', content: slug }]),
    );
    stubServer(packages);
    await download();
    const path = join(projectRoot, '.agentteams/skills.manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (kind === 'slug') manifest.entries[0].slug = '../invalid';
    if (kind === 'mirror') manifest.entries[0].mirrorPaths = ['../outside'];
    if (kind === 'duplicate') {
      manifest.entries[0].slug = 'second';
      manifest.entries[0].mirrorPaths = [];
    }
    writeFileSync(path, JSON.stringify(manifest));
    packages[2].version = 'v2';
    packages[2].files[0].content = '갱신';
    const result = await download({ force: true, all: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.downloaded.map((item: { slug: string }) => item.slug)).toContain('healthy');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/healthy/SKILL.md'), 'utf8')).toBe('갱신');
    expect(readFileSync(join(projectRoot, '.agentteams/skills/first/SKILL.md'), 'utf8')).toBe('first');
    expect(
      JSON.parse(readFileSync(path, 'utf8')).entries.find(
        (entry: { skillId: string }) => entry.skillId === packages[0].id,
      ),
    ).toEqual(manifest.entries[0]);
  });

  it('동일 경로를 요구하는 원격 패키지 모두를 보존하고 정상 패키지만 적용한다', async () => {
    const first = remoteSkill('same-slug', [{ relativePath: 'SKILL.md', content: 'first' }]);
    stubServer([
      first,
      { ...first, id: 'second-owner' },
      remoteSkill('healthy', [{ relativePath: 'SKILL.md', content: '정상' }]),
    ]);
    const result = await download();
    expect(result.conflicts).toHaveLength(2);
    expect(result.downloaded.map((item: { slug: string }) => item.slug)).toEqual(['healthy']);
    expect(existsSync(join(projectRoot, '.agentteams/skills/same-slug'))).toBe(false);
  });
});

describe('구형 삭제와 링크 경계', () => {
  it('v1에서 원본과 미러를 모두 지운 경우 자동 복원하지 않는다', async () => {
    stubServer([remoteSkill('example', [{ relativePath: 'SKILL.md', content: '원본' }])]);
    await download();
    const path = join(projectRoot, '.agentteams/skills.manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.version = 1;
    delete manifest.entries[0].fileHashes;
    writeFileSync(path, JSON.stringify(manifest));
    rmSync(join(projectRoot, '.agentteams/skills/example'), { recursive: true });
    rmSync(join(projectRoot, '.agents/skills/example'), { recursive: true });
    expect((await download()).conflicts).toHaveLength(1);
    expect(existsSync(join(projectRoot, '.agentteams/skills/example'))).toBe(false);
  });

  it('force도 미러 상위 디렉터리 링크를 따라 쓰지 않는다', async () => {
    stubServer([remoteSkill('example', [{ relativePath: 'SKILL.md', content: '원본' }])]);
    const outside = join(projectRoot, 'outside');
    mkdirSync(outside);
    mkdirSync(join(projectRoot, '.agents'));
    symlinkSync(outside, join(projectRoot, '.agents/skills'), 'junction');
    const result = await download({ id: 'id-example', force: true });
    expect(result.conflicts[0].paths).toContainEqual({ path: '.agents/skills', reason: 'unsafe' });
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(projectRoot, '.agentteams/skills/example/SKILL.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(projectRoot, '.agentteams/skills.manifest.json'), 'utf8'));
    expect(manifest.entries[0].mirrorPaths).toEqual([]);
  });
  it('미러 루트 전체가 없어지면 원본을 갱신하고 선택한 미러를 다시 만든다', async () => {
    const pkg = remoteSkill('example', [{ relativePath: 'SKILL.md', content: '원본' }]);
    stubServer([pkg]);
    await download({ skillTargets: 'agents,claude' });
    rmSync(join(projectRoot, '.agents'), { recursive: true });
    rmSync(join(projectRoot, '.claude'), { recursive: true });
    pkg.version = 'v2';
    pkg.files[0].content = '새 본문';
    const result = await download({ skillTargets: 'agents,claude' });
    expect(result.conflicts).toEqual([]);
    for (const base of ['.agentteams', '.agents', '.claude']) {
      expect(readFileSync(join(projectRoot, base, 'skills/example/SKILL.md'), 'utf8')).toBe('새 본문');
    }
  });

  it('기존 미러가 링크로 바뀌어도 기준을 유지하며 안전한 원본은 갱신한다', async () => {
    const pkg = remoteSkill('example', [{ relativePath: 'SKILL.md', content: '원본' }]);
    stubServer([pkg]);
    await download();
    const manifestPath = join(projectRoot, '.agentteams/skills.manifest.json');
    const before = JSON.parse(readFileSync(manifestPath, 'utf8')).entries[0];
    rmSync(join(projectRoot, '.agents/skills'), { recursive: true });
    const outside = join(projectRoot, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.agents/skills'), 'junction');
    pkg.version = 'v2';
    pkg.files[0].content = '업데이트';
    const result = await download();
    expect(result.downloaded).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(readdirSync(outside)).toEqual([]);
    const after = JSON.parse(readFileSync(manifestPath, 'utf8')).entries[0];
    expect(after.fileHashes['.agents/skills/example/SKILL.md']).toBe(
      before.fileHashes['.agents/skills/example/SKILL.md'],
    );
    expect(readFileSync(join(projectRoot, '.agentteams/skills/example/SKILL.md'), 'utf8')).toBe('업데이트');
  });
});
