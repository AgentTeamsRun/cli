import { afterEach, beforeEach, describe, it, expect } from '@jest/globals';
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_LIMITS,
  SkillPackageError,
  collectSkillPackageFiles,
  computeSkillVersion,
  detectSkillMirrorTargets,
  ensureMirrorGitignore,
  mirrorDirFor,
  parseSkillTargetsOption,
  readSkillManifest,
  removeManifestPaths,
  validateSkillPackageFiles,
  writePackageAtomically,
  writeSkillManifest,
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
});

describe('atomic package replacement', () => {
  it('leaves the previous package byte-for-byte intact when a write fails midway', () => {
    const targetDir = join(projectRoot, '.agentteams', 'skills', 'my-skill');
    writeFile(join(targetDir, 'SKILL.md'), entryContent());
    writeFile(join(targetDir, 'references', 'keep.md'), 'original');
    const before = readFileSync(join(targetDir, 'references', 'keep.md'), 'utf8');

    expect(() =>
      writePackageAtomically(targetDir, [
        { relativePath: 'SKILL.md', content: 'new entry' },
        { relativePath: '../escape.md', content: 'boom' },
      ]),
    ).toThrow(SkillPackageError);

    expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf8')).toBe(entryContent());
    expect(readFileSync(join(targetDir, 'references', 'keep.md'), 'utf8')).toBe(before);
    // 임시 디렉터리가 남으면 다음 실행이 남의 찌꺼기 위에서 시작한다.
    const leftovers = readdirSync(join(projectRoot, '.agentteams', 'skills')).filter((name) =>
      name.includes('staging'),
    );
    expect(leftovers).toEqual([]);
  });

  it('replaces the package and drops files that are no longer part of it', () => {
    const targetDir = join(projectRoot, '.agentteams', 'skills', 'my-skill');
    writeFile(join(targetDir, 'SKILL.md'), entryContent());
    writeFile(join(targetDir, 'references', 'old.md'), 'old');

    writePackageAtomically(targetDir, [{ relativePath: 'SKILL.md', content: 'updated' }]);

    expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf8')).toBe('updated');
    expect(existsSync(join(targetDir, 'references', 'old.md'))).toBe(false);
  });
});

describe('manifest-scoped mirror cleanup', () => {
  it('removes only the paths the CLI recorded and leaves user files alone', () => {
    const mirrorDir = mirrorDirFor(projectRoot, 'agents', 'my-skill');
    writeFile(join(mirrorDir, 'SKILL.md'), entryContent());
    writeFile(join(mirrorDir, 'user-note.md'), 'mine');

    writeSkillManifest(projectRoot, {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: [
        {
          skillId: 'skill-1',
          slug: 'my-skill',
          version: 'v1',
          mirrorPaths: ['.agents/skills/my-skill/SKILL.md'],
        },
      ],
    });

    const manifest = readSkillManifest(projectRoot);
    removeManifestPaths(projectRoot, manifest.entries[0].mirrorPaths);

    expect(existsSync(join(mirrorDir, 'SKILL.md'))).toBe(false);
    expect(readFileSync(join(mirrorDir, 'user-note.md'), 'utf8')).toBe('mine');
  });

  it('ignores manifest paths that escape the project root', () => {
    const outside = join(projectRoot, '..', `escape-${process.pid}.md`);
    writeFileSync(outside, 'do not delete', 'utf8');

    try {
      removeManifestPaths(projectRoot, ['../escape-' + process.pid + '.md']);
      expect(readFileSync(outside, 'utf8')).toBe('do not delete');
    } finally {
      rmSync(outside, { force: true });
    }
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
