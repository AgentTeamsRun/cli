import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conventionDownload } from '../src/commands/convention.js';

/**
 * `convention download`는 manifest에 기록한 파일만 소유한다. 서버나 구형 manifest에 레거시
 * `category='skills'` 행이 남아 있어도 `.agentteams/skills/`는 `skill download`만 관리한다는
 * 계약이 코드에서 실제로 지켜지는지 여기서 고정한다.
 */

const PROJECT_ID = 'project-skill-ownership';
const API_URL = 'https://api.example.test';

const tempRoots: string[] = [];

afterEach(() => {
  jest.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

const createTempProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-skill-ownership-'));
  mkdirSync(join(root, '.agentteams'), { recursive: true });
  writeFileSync(
    join(root, '.agentteams', 'config.json'),
    JSON.stringify({ projectId: PROJECT_ID, teamId: 'team-1' }),
    'utf-8',
  );
  return root;
};

const installSkillPackage = (root: string, slug: string) => {
  const packageDir = join(root, '.agentteams', 'skills', slug);
  mkdirSync(join(packageDir, 'references'), { recursive: true });
  writeFileSync(join(packageDir, 'SKILL.md'), `---\nname: ${slug}\ndescription: >-\n  x\n---\n\n# ${slug}\n`, 'utf-8');
  writeFileSync(join(packageDir, 'references', 'notes.md'), 'keep me', 'utf-8');
  return packageDir;
};

/** 레거시 skill 행이 아직 남아 있는 서버 상태를 흉내 낸다 — 가장 위험한 조합이다. */
const mockDownloadResponses = (conventions: Record<string, unknown>[]) => {
  jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
    if (url.endsWith('/api/platform/guides')) return { data: { data: [] } };
    if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
    if (url.endsWith('/agent-configs')) return { data: { data: [{ id: 'agent-first' }] } };
    if (url.endsWith('/convention')) return { data: { data: { content: '# AGENT_RULES\n' } } };
    if (url.endsWith('/download-all')) return { data: { data: conventions } };
    throw new Error(`unexpected GET ${url}`);
  }) as never);
};

const download = (root: string) =>
  conventionDownload({
    cwd: root,
    config: { projectId: PROJECT_ID, teamId: 'team-1', apiUrl: API_URL, apiKey: 'key_test' } as never,
  });

describe('convention download vs skill packages', () => {
  it('leaves .agentteams/skills/<slug>/ untouched even when the server still returns skill-category rows', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const packageDir = installSkillPackage(root, 'dev-cli');

    mockDownloadResponses([
      {
        id: 'legacy-skill-row',
        title: 'dev cli',
        category: 'skills',
        fileName: 'dev-cli.md',
        contentMarkdown: '# legacy\n',
      },
      {
        id: 'rules-row',
        title: 'conventions',
        category: 'rules',
        fileName: 'conventions.md',
        contentMarkdown: '# r\n',
      },
    ]);

    const result = await download(root);

    expect(existsSync(join(packageDir, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(packageDir, 'references', 'notes.md'), 'utf-8')).toBe('keep me');
    expect(result.unmanagedFiles).toBeUndefined();
  });

  it('keeps unmanaged files while writing conventions in the same category', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const staleFile = join(root, '.agentteams', 'rules', 'removed-on-server.md');
    mkdirSync(join(root, '.agentteams', 'rules'), { recursive: true });
    writeFileSync(staleFile, 'stale', 'utf-8');

    mockDownloadResponses([
      {
        id: 'rules-row',
        title: 'conventions',
        category: 'rules',
        fileName: 'conventions.md',
        contentMarkdown: '# r\n',
      },
    ]);

    await download(root);

    expect(readFileSync(staleFile, 'utf-8')).toBe('stale');
    expect(existsSync(join(root, '.agentteams', 'rules', 'conventions.md'))).toBe(true);
  });
});

/**
 * 호환 매트릭스: (구/신 CLI) × (이관 전/후). 구 CLI는 이 저장소에서 실행할 수 없으므로, 구 CLI가
 * 의존하는 **계약**(레거시 flat 파일 쓰기, conventions.manifest.json 스키마)이 유지되는지로 대신
 * 확인한다. 신 CLI 축은 실제 실행으로 확인한다.
 */
describe('compatibility matrix', () => {
  it('신CLI × 이관전: 레거시 skill 행은 여전히 flat 파일로 쓰이고 패키지도 살아남는다', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const packageDir = installSkillPackage(root, 'dev-cli');

    mockDownloadResponses([
      {
        id: 'legacy-skill-row',
        title: 'dev cli',
        category: 'skills',
        fileName: 'dev-cli.md',
        contentMarkdown: '# legacy body\n',
      },
    ]);

    await download(root);

    // 이관 전에는 서버가 아직 그 행을 준다. 구 CLI가 기대하는 flat 파일 쓰기는 그대로 유지된다.
    expect(readFileSync(join(root, '.agentteams', 'skills', 'dev-cli.md'), 'utf-8')).toContain('legacy body');
    // 동시에 신규 패키지는 손상되지 않는다(sweep 제외 덕분).
    expect(existsSync(join(packageDir, 'SKILL.md'))).toBe(true);
  });

  it('신CLI × 이관후: 서버가 skill 행을 더 이상 주지 않아도 패키지는 그대로다', async () => {
    const root = createTempProject();
    tempRoots.push(root);
    const packageDir = installSkillPackage(root, 'dev-cli');

    mockDownloadResponses([
      {
        id: 'rules-row',
        title: 'conventions',
        category: 'rules',
        fileName: 'conventions.md',
        contentMarkdown: '# r\n',
      },
    ]);

    await download(root);

    expect(existsSync(join(packageDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.agentteams', 'rules', 'conventions.md'))).toBe(true);
  });

  it('구CLI 축: conventions.manifest.json 스키마가 그대로 유지된다', async () => {
    const root = createTempProject();
    tempRoots.push(root);

    mockDownloadResponses([
      {
        id: 'rules-row',
        title: 'conventions',
        category: 'rules',
        fileName: 'conventions.md',
        contentMarkdown: '# r\n',
      },
    ]);

    await download(root);

    const manifest = JSON.parse(readFileSync(join(root, '.agentteams', 'conventions.manifest.json'), 'utf-8'));
    // 구 CLI가 파싱하는 필드 집합. Skill 엔트리를 여기 섞으면 구 버전이 깨진다.
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.entries)).toBe(true);
    // 구 CLI가 읽는 필드가 빠지지 않았는지만 본다(추가 필드는 무시되므로 호환에 영향 없음).
    for (const field of ['conventionId', 'fileRelativePath', 'fileName', 'categoryDir', 'downloadedAt']) {
      expect(Object.keys(manifest.entries[0])).toContain(field);
    }
    expect(manifest.entries[0]).not.toHaveProperty('skillId');
    expect(manifest.entries.some((entry: { categoryDir: string }) => entry.categoryDir === 'skills')).toBe(false);
  });
});
