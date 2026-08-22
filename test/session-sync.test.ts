import { afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffConventionSnapshots, sessionSync, snapshotConventionFiles } from '../src/commands/session.js';

let projectRoot = '';

const write = (relativePath: string, content: string) => {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
};

const rule = (trigger: string, body: string) => `---\ntrigger: ${trigger}\n---\n\n${body}\n`;

/** 매니페스트에 등재된 파일만 스냅샷 대상이 된다 — 실제 다운로드가 쓰는 형식 그대로 만든다. */
const writeManifest = (paths: string[]) => {
  write(
    '.agentteams/conventions.manifest.json',
    JSON.stringify({
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      entries: paths.map((path, index) => ({
        conventionId: `c${index}`,
        fileRelativePath: path,
        fileName: path.split('/').pop(),
        categoryDir: 'rules',
        downloadedAt: '2026-01-01T00:00:00.000Z',
      })),
    }),
  );
};

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'agentteams-session-sync-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('snapshotConventionFiles', () => {
  it('reads the trigger of every deployed convention file', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'ko'));
    write('.agentteams/rules/schema.md', rule('model_decision', 'prisma'));
    writeManifest(['.agentteams/rules/context.md', '.agentteams/rules/schema.md']);

    const snapshot = snapshotConventionFiles(projectRoot);
    expect(snapshot.get('.agentteams/rules/context.md')?.alwaysOn).toBe(true);
    expect(snapshot.get('.agentteams/rules/schema.md')?.alwaysOn).toBe(false);
  });

  // convention.md는 매니페스트 엔트리가 아니라 별도 경로로 배포된다. 매니페스트만 훑으면
  // always_on인 이 파일이 재독 대상에서 통째로 빠진다.
  it('includes convention.md even though the manifest never lists it', () => {
    write('.agentteams/convention.md', rule('always_on', '# AgentTeams Convention'));
    writeManifest([]);

    expect(snapshotConventionFiles(projectRoot).has('.agentteams/convention.md')).toBe(true);
  });

  it('treats a file with broken frontmatter as not always-on instead of throwing', () => {
    write('.agentteams/rules/broken.md', '---\ntrigger: [unclosed\n---\nbody\n');
    writeManifest(['.agentteams/rules/broken.md']);

    const snapshot = snapshotConventionFiles(projectRoot);
    expect(snapshot.get('.agentteams/rules/broken.md')?.alwaysOn).toBe(false);
  });

  it('omits files the manifest lists but that are not on disk', () => {
    writeManifest(['.agentteams/rules/gone.md']);
    expect(snapshotConventionFiles(projectRoot).size).toBe(0);
  });
});

describe('diffConventionSnapshots', () => {
  const snapshotOf = (paths: string[]) => {
    writeManifest(paths.filter((path) => !path.endsWith('convention.md')));
    return snapshotConventionFiles(projectRoot);
  };

  it('lists an always-on file whose bytes changed, and leaves untouched ones out', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'v1'));
    write('.agentteams/rules/my.md', rule('always_on', 'same'));
    const before = snapshotOf(['.agentteams/rules/context.md', '.agentteams/rules/my.md']);

    write('.agentteams/rules/context.md', rule('always_on', 'v2'));
    const after = snapshotOf(['.agentteams/rules/context.md', '.agentteams/rules/my.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual(['.agentteams/rules/context.md']);
  });

  // model_decision은 필요할 때 여는 등급이다. 세션 시작에 재독시키면 always_on을 늘린 셈이 된다.
  it('ignores a changed model_decision file', () => {
    write('.agentteams/rules/schema.md', rule('model_decision', 'v1'));
    const before = snapshotOf(['.agentteams/rules/schema.md']);

    write('.agentteams/rules/schema.md', rule('model_decision', 'v2'));
    const after = snapshotOf(['.agentteams/rules/schema.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual([]);
  });

  it('lists a newly deployed always-on file', () => {
    const before = snapshotOf([]);
    write('.agentteams/rules/new.md', rule('always_on', 'fresh'));
    const after = snapshotOf(['.agentteams/rules/new.md']);

    expect(diffConventionSnapshots(before, after).reread).toEqual(['.agentteams/rules/new.md']);
  });

  // 사라진 규칙은 재독할 파일이 없다. 그래도 에이전트 컨텍스트에는 남아 있으므로 신호가 필요하다.
  it('reports a removed always-on file as invalidated, not as reread', () => {
    write('.agentteams/rules/legacy.md', rule('always_on', 'old'));
    const before = snapshotOf(['.agentteams/rules/legacy.md']);

    unlinkSync(join(projectRoot, '.agentteams/rules/legacy.md'));
    const after = snapshotOf([]);

    const result = diffConventionSnapshots(before, after);
    expect(result.reread).toEqual([]);
    expect(result.invalidated).toEqual(['.agentteams/rules/legacy.md']);
  });

  it('reports nothing when the deployed bytes are identical', () => {
    write('.agentteams/rules/context.md', rule('always_on', 'stable'));
    const before = snapshotOf(['.agentteams/rules/context.md']);
    const after = snapshotOf(['.agentteams/rules/context.md']);

    expect(diffConventionSnapshots(before, after)).toEqual({ reread: [], invalidated: [] });
  });
});

describe('sessionSync', () => {
  // 스킬 목록이 바뀌면 convention.md의 Skill Index도 달라진다. `checkConventionFreshness`는 그
  // 축을 보지 않으므로(컨벤션 레코드와 플랫폼 가이드 해시만 본다), 스킬만 바뀐 세션에서
  // 컨벤션을 다시 받지 않으면 인덱스가 낡은 채로 남는다. 순서도 중요하다 — 컨벤션 다운로드가
  // 스킬 동기화보다 앞서면 방금 바뀐 스킬이 빠진 인덱스를 받는다.
  it('re-downloads the convention after skills change, and does so in that order', () => {
    const source = readFileSync(new URL('../src/commands/session.ts', import.meta.url), 'utf8');

    const skillsAt = source.indexOf('await syncSkills(');
    const conventionAt = source.indexOf('await conventionDownload(');
    expect(skillsAt).toBeGreaterThan(-1);
    expect(conventionAt).toBeGreaterThan(-1);
    expect(skillsAt).toBeLessThan(conventionAt);
    expect(source).toMatch(/conventionUpdateAvailable \|\| synced\.platformGuides \|\| synced\.skills/);
  });

  // 세션 시작을 막지 않는 것이 이 명령의 첫 번째 계약이다. 미설정 프로젝트에서 던지면
  // 에이전트가 본 작업을 시작도 못 하고 멈춘다.
  it('returns a clean result without any network call when the directory is not a project', async () => {
    const result = await sessionSync({ cwd: projectRoot });

    expect(result.reread).toEqual([]);
    expect(result.invalidated).toEqual([]);
    expect(result.synced).toEqual({ conventions: false, skills: false, platformGuides: false });
    expect(result.cliUpdateAvailable).toBe(false);
    expect(result.notes).toEqual(['Not an AgentTeams project — nothing to sync.']);
  });
});
