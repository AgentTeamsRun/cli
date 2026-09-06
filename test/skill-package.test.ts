import { afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_LIMITS,
  SkillPackageError,
  collectSkillPackageFiles,
  computeSkillVersion,
  detectSkillMirrorTargets,
  findUnregisteredSkillSlugs,
  ensureMirrorGitignore,
  parseSkillTargetsOption,
  validateSkillPackageFiles,
} from '../src/utils/skillPackage.js';

let projectRoot = '';

const entryContent = (slug = 'my-skill') =>
  `---\nname: ${slug}\ndescription: >-\n  Does the thing.\n---\n\n# My Skill\n`;

const writeFile = (path: string, content: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
};

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-pkg-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('parseSkillTargetsOption', () => {
  it('parses a comma-separated list and normalizes duplicates', () => {
    expect(parseSkillTargetsOption('agents,claude,agents')).toEqual(['agents', 'claude']);
  });

  it('returns an empty list for none and null when unset', () => {
    expect(parseSkillTargetsOption('none')).toEqual([]);
    expect(parseSkillTargetsOption(undefined)).toBeNull();
  });

  it('rejects unknown values and none combined with other targets', () => {
    expect(() => parseSkillTargetsOption('cursor')).toThrow(SkillPackageError);
    expect(() => parseSkillTargetsOption('none,agents')).toThrow(SkillPackageError);
  });
});

describe('mirror target detection', () => {
  it('always includes .agents and gates the rest on marker directories', () => {
    expect(detectSkillMirrorTargets(projectRoot)).toEqual(['agents']);

    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    expect(detectSkillMirrorTargets(projectRoot)).toEqual(['agents', 'claude']);

    mkdirSync(join(projectRoot, '.github'), { recursive: true });
    expect(detectSkillMirrorTargets(projectRoot)).toEqual(['agents', 'claude', 'github']);
  });

  // 마커 탐지만 쓰면 `.claude/`가 없는 저장소의 CLAUDE_CODE가 미러를 통째로 못 받는다.
  // 러너가 `--skill-targets`로 매번 보정하던 자리라, 엔진을 알면 마커 없이도 붙어야 한다.
  it("adds the running engine's own path even without its marker directory", () => {
    expect(detectSkillMirrorTargets(projectRoot, 'CLAUDE_CODE')).toEqual(['agents', 'claude']);
  });

  // `.agents`를 읽는 엔진에 `claude`까지 붙이면 한 엔진이 같은 스킬을 두 번 로드한다
  // (skill-package-guide.md §5). 미측정 엔진도 근거 없는 매핑보다 마커 폴백이 낫다.
  it('leaves detection untouched for engines covered by .agents and for unmeasured ones', () => {
    expect(detectSkillMirrorTargets(projectRoot, 'CODEX')).toEqual(['agents']);
    expect(detectSkillMirrorTargets(projectRoot, 'ANTIGRAVITY')).toEqual(['agents']);
    expect(detectSkillMirrorTargets(projectRoot, undefined)).toEqual(['agents']);
  });
});

describe('unregistered local packages', () => {
  // `skill status`는 매니페스트와 원격만 비교했다. 방금 만들고 `skill create --apply`를 안 한
  // 패키지는 양쪽 어디에도 없어 보이지 않았고, 그 침묵을 convention.md가 상시 산문으로 메우고
  // 있었다(355자). 이제 도구가 잊은 그 시점에 말한다.
  it('reports a package directory that is in neither the manifest nor the remote', () => {
    mkdirSync(join(projectRoot, '.agentteams', 'skills', 'brand-new'), { recursive: true });
    writeFileSync(join(projectRoot, '.agentteams', 'skills', 'brand-new', 'SKILL.md'), entryContent('brand-new'));

    expect(findUnregisteredSkillSlugs(projectRoot, new Set())).toEqual(['brand-new']);
  });

  it('stays silent for packages the manifest or the remote already knows', () => {
    mkdirSync(join(projectRoot, '.agentteams', 'skills', 'known'), { recursive: true });
    writeFileSync(join(projectRoot, '.agentteams', 'skills', 'known', 'SKILL.md'), entryContent('known'));

    expect(findUnregisteredSkillSlugs(projectRoot, new Set(['known']))).toEqual([]);
  });

  // SKILL.md가 없으면 패키지가 아니다 — 작업 중 디렉터리를 미등록으로 신고하면 매 세션 잡음이 된다.
  it('ignores a directory with no SKILL.md', () => {
    mkdirSync(join(projectRoot, '.agentteams', 'skills', 'scratch'), { recursive: true });

    expect(findUnregisteredSkillSlugs(projectRoot, new Set())).toEqual([]);
  });
});

describe('package validation', () => {
  it('accepts an entry file with resources under the allowed directories', () => {
    expect(() =>
      validateSkillPackageFiles([
        { relativePath: 'SKILL.md', content: entryContent() },
        { relativePath: 'references/notes.md', content: 'notes' },
        { relativePath: 'scripts/run.sh', content: '#!/bin/sh\n' },
      ]),
    ).not.toThrow();
  });

  it('rejects unsafe paths, duplicates, case collisions and oversized files before the API call', () => {
    const entry = { relativePath: 'SKILL.md', content: entryContent() };

    expect(() => validateSkillPackageFiles([entry, { relativePath: '../escape.md', content: 'x' }])).toThrow(
      /traverse/,
    );
    expect(() => validateSkillPackageFiles([entry, { relativePath: '/etc/passwd', content: 'x' }])).toThrow(/relative/);
    expect(() => validateSkillPackageFiles([entry, { relativePath: 'assets/logo.bin', content: 'x' }])).toThrow(
      /must live under/,
    );
    expect(() => validateSkillPackageFiles([entry, { relativePath: 'README.md', content: 'x' }])).toThrow(
      /only file allowed at the package root/,
    );
    expect(() =>
      validateSkillPackageFiles([
        entry,
        { relativePath: 'references/a.md', content: '1' },
        { relativePath: 'references/A.md', content: '2' },
      ]),
    ).toThrow(/collide case-insensitively/);
    expect(() =>
      validateSkillPackageFiles([
        entry,
        { relativePath: 'references/big.md', content: 'x'.repeat(SKILL_LIMITS.resourceFileBytes + 1) },
      ]),
    ).toThrow(/exceeds/);
    expect(() => validateSkillPackageFiles([{ relativePath: 'references/a.md', content: 'x' }])).toThrow(
      /must contain SKILL.md/,
    );
  });

  it('refuses to collect a package containing a symlink', () => {
    const packageDir = join(projectRoot, 'pkg');
    writeFile(join(packageDir, 'SKILL.md'), entryContent());
    mkdirSync(join(packageDir, 'references'), { recursive: true });
    symlinkSync(join(projectRoot, 'outside.md'), join(packageDir, 'references', 'link.md'));

    expect(() => collectSkillPackageFiles(packageDir)).toThrow(/Symlinks are not allowed/);
  });

  it('refuses to collect a package containing a binary resource', () => {
    const packageDir = join(projectRoot, 'pkg');
    writeFile(join(packageDir, 'SKILL.md'), entryContent());
    mkdirSync(join(packageDir, 'scripts'), { recursive: true });
    // PNG 매직 바이트 + invalid UTF-8 연속(0xff, 0xfe) — NUL 없이도 디코드 왕복이 깨져야 한다.
    writeFileSync(
      join(packageDir, 'scripts', 'logo.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x8b]),
    );

    expect(() => collectSkillPackageFiles(packageDir)).toThrow(/must be UTF-8 text \(not valid UTF-8\)/);
  });

  it('refuses to collect a text file containing a null byte', () => {
    const packageDir = join(projectRoot, 'pkg');
    writeFile(join(packageDir, 'SKILL.md'), entryContent());
    mkdirSync(join(packageDir, 'references'), { recursive: true });
    writeFileSync(join(packageDir, 'references', 'nul.txt'), Buffer.from('before\0after'));

    expect(() => collectSkillPackageFiles(packageDir)).toThrow(/must be UTF-8 text \(found a null byte\)/);
  });

  it('collects valid UTF-8 resources with their content unchanged', () => {
    const packageDir = join(projectRoot, 'pkg');
    writeFile(join(packageDir, 'SKILL.md'), entryContent());
    const original = '한글 텍스트와 emoji 🚀 탭(\t) CRLF(\r\n)';
    writeFile(join(packageDir, 'references', 'notes.md'), original);

    const files = collectSkillPackageFiles(packageDir);
    expect(files.find((file) => file.relativePath === 'references/notes.md')?.content).toBe(original);
  });

  it('skips well-known OS junk files instead of failing collection', () => {
    const packageDir = join(projectRoot, 'pkg');
    writeFile(join(packageDir, 'SKILL.md'), entryContent());
    mkdirSync(join(packageDir, 'references'), { recursive: true });
    writeFile(join(packageDir, 'references', 'notes.md'), 'notes');
    // Finder/Explorer가 넣는 바이너리 — NUL이 있어 콘텐츠 검사에 걸리면 push 전체가 멈춘다.
    writeFileSync(
      join(packageDir, 'references', '.DS_Store'),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]),
    );
    writeFileSync(join(packageDir, 'Thumbs.db'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    writeFileSync(join(packageDir, 'references', '._notes.md'), Buffer.from([0x00, 0x05, 0x16, 0x07]));

    const files = collectSkillPackageFiles(packageDir);
    expect(files.map((file) => file.relativePath).sort()).toEqual(['SKILL.md', 'references/notes.md']);
  });
});

describe('gitignore handling', () => {
  it('adds mirror directories once and is idempotent', () => {
    ensureMirrorGitignore(projectRoot, ['agents', 'claude']);
    ensureMirrorGitignore(projectRoot, ['agents', 'claude']);

    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(content.match(/\.agents\/skills\//g)).toHaveLength(1);
    expect(content).toContain('.claude/skills/');
  });

  it('writes nothing when there are no mirror targets', () => {
    ensureMirrorGitignore(projectRoot, []);
    expect(existsSync(join(projectRoot, '.gitignore'))).toBe(false);
  });
});

describe('package version', () => {
  it('is stable across file ordering and changes with content', () => {
    const files = [
      { relativePath: 'SKILL.md', content: entryContent() },
      { relativePath: 'references/a.md', content: 'a' },
    ];

    expect(computeSkillVersion(files)).toBe(computeSkillVersion([...files].reverse()));
    expect(computeSkillVersion(files)).not.toBe(
      computeSkillVersion([files[0], { relativePath: 'references/a.md', content: 'b' }]),
    );
  });
});
