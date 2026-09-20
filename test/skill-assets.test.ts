import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const entryContent = (slug: string) => `---\nname: ${slug}\ndescription: >-\n  Does the thing.\n---\n\n# Skill\n`;

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const pngSha = createHash('sha256').update(pngBytes).digest('hex');

let projectRoot = '';

const writePackage = (slug: string, withAsset = true) => {
  const dir = join(projectRoot, 'pkg', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), entryContent(slug), 'utf8');
  if (withAsset) {
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'logo.png'), pngBytes);
  }
  return dir;
};

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-assets-'));
  mkdirSync(join(projectRoot, '.agentteams'), { recursive: true });
});

afterEach(() => {
  jest.clearAllMocks();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('skill asset download', () => {
  it('writes asset bytes to the package and mirrors with the declared hash', async () => {
    listSkills.mockImplementation((async () => ({
      data: [{ id: 'id-asset', slug: 'asset-skill', version: 'v1' }],
      meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
    })) as never);
    downloadSkill.mockImplementation((async () => ({
      data: {
        id: 'id-asset',
        slug: 'asset-skill',
        version: 'v1',
        files: [
          { relativePath: 'SKILL.md', content: entryContent('asset-skill') },
          {
            relativePath: 'assets/logo.png',
            kind: 'BINARY',
            sha256: pngSha,
            sizeBytes: pngBytes.length,
            mimeType: 'image/png',
            downloadUrl: 'https://cdn.test/logo.png',
          },
        ],
      },
    })) as never);
    fetchSkillAssetBytes.mockImplementation((async (url: string) => {
      expect(url).toBe('https://cdn.test/logo.png');
      return pngBytes;
    }) as never);

    await executeSkillCommand('https://api.example.test', 'project-1', {}, 'download', {
      cwd: projectRoot,
      id: 'id-asset',
      force: true,
    });

    for (const root of ['.agentteams/skills/asset-skill', '.agents/skills/asset-skill']) {
      const stored = readFileSync(join(projectRoot, root, 'assets', 'logo.png'));
      expect(stored.equals(pngBytes)).toBe(true);
    }
    expect(fetchSkillAssetBytes).toHaveBeenCalledTimes(1);
  });

  it('fails the whole package on hash mismatch and keeps existing files', async () => {
    const existing = join(projectRoot, '.agentteams', 'skills', 'asset-skill');
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, 'SKILL.md'), 'old', 'utf8');

    listSkills.mockImplementation((async () => ({
      data: [{ id: 'id-asset', slug: 'asset-skill', version: 'v2' }],
      meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
    })) as never);
    downloadSkill.mockImplementation((async () => ({
      data: {
        id: 'id-asset',
        slug: 'asset-skill',
        version: 'v2',
        files: [
          { relativePath: 'SKILL.md', content: entryContent('asset-skill') },
          {
            relativePath: 'assets/logo.png',
            kind: 'BINARY',
            sha256: pngSha,
            sizeBytes: pngBytes.length,
            mimeType: 'image/png',
            downloadUrl: 'https://cdn.test/logo.png',
          },
        ],
      },
    })) as never);
    fetchSkillAssetBytes.mockImplementation((async () => Buffer.from('tampered')) as never);

    await expect(
      executeSkillCommand('https://api.example.test', 'project-1', {}, 'download', {
        cwd: projectRoot,
        id: 'id-asset',
        force: true,
      }),
    ).rejects.toThrow(/hash mismatch/);
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toBe('old');
    expect(existsSync(join(existing, 'assets', 'logo.png'))).toBe(false);
  });
});

describe('skill asset upload', () => {
  it('shows assets in dry-run without any API call', async () => {
    const dir = writePackage('dry-skill');

    const result = (await executeSkillCommand('https://api.example.test', 'project-1', {}, 'create', {
      cwd: projectRoot,
      dir,
      slug: 'dry-skill',
    })) as { dryRun: boolean; assets: { relativePath: string; sizeBytes: number }[] };

    expect(result.dryRun).toBe(true);
    expect(result.assets).toEqual([{ relativePath: 'assets/logo.png', sizeBytes: pngBytes.length }]);
    expect(requestSkillAssetUploadUrls).not.toHaveBeenCalled();
    expect(createSkill).not.toHaveBeenCalled();
  });

  it('uploads new assets on create and sends draft keys with the assets-aware flag', async () => {
    const dir = writePackage('new-skill');
    requestSkillAssetUploadUrls.mockImplementation((async () => [
      { relativePath: 'assets/logo.png', draftKey: 'drafts/m/1', uploadUrl: 'https://up.test/1' },
    ]) as never);
    putSkillAssetBytes.mockImplementation((async () => undefined) as never);
    createSkill.mockImplementation((async () => ({ data: { id: 'new-id' } })) as never);

    await executeSkillCommand('https://api.example.test', 'project-1', {}, 'create', {
      cwd: projectRoot,
      dir,
      slug: 'new-skill',
      apply: true,
    });

    expect(requestSkillAssetUploadUrls).toHaveBeenCalledTimes(1);
    expect(putSkillAssetBytes).toHaveBeenCalledTimes(1);
    const putCall = (putSkillAssetBytes.mock.calls[0] as unknown[]).slice(0, 3);
    expect(putCall[0]).toBe('https://up.test/1');
    expect((putCall[1] as Buffer).equals(pngBytes)).toBe(true);
    expect(putCall[2]).toBe('image/png');
    const body = createSkill.mock.calls[0][3] as {
      files: Record<string, unknown>[];
      assetsAware: boolean;
    };
    expect(body.assetsAware).toBe(true);
    expect(body.files).toContainEqual({
      relativePath: 'assets/logo.png',
      kind: 'BINARY',
      sha256: pngSha,
      sizeBytes: pngBytes.length,
      mimeType: 'image/png',
      draftKey: 'drafts/m/1',
    });
  });

  it('reuses unchanged assets on update without an upload URL request', async () => {
    const dir = writePackage('kept-skill');
    getSkill.mockImplementation((async () => ({
      data: {
        updatedAt: '2026-09-15T00:00:00.000Z',
        files: [{ relativePath: 'assets/logo.png', kind: 'BINARY', sha256: pngSha }],
      },
    })) as never);
    updateSkill.mockImplementation((async () => ({ data: { id: 'kept-id' } })) as never);

    await executeSkillCommand('https://api.example.test', 'project-1', {}, 'update', {
      cwd: projectRoot,
      dir,
      id: 'kept-id',
      apply: true,
    });

    expect(requestSkillAssetUploadUrls).not.toHaveBeenCalled();
    expect(putSkillAssetBytes).not.toHaveBeenCalled();
    const body = updateSkill.mock.calls[0][4] as {
      files: Record<string, unknown>[];
      assetsAware: boolean;
    };
    expect(body.assetsAware).toBe(true);
    expect(body.files).toContainEqual({
      relativePath: 'assets/logo.png',
      kind: 'BINARY',
      sha256: pngSha,
      reuse: true,
    });
  });

  it('uploads only changed assets on update', async () => {
    const dir = writePackage('changed-skill');
    getSkill.mockImplementation((async () => ({
      data: {
        updatedAt: '2026-09-15T00:00:00.000Z',
        files: [{ relativePath: 'assets/logo.png', kind: 'BINARY', sha256: '0'.repeat(64) }],
      },
    })) as never);
    requestSkillAssetUploadUrls.mockImplementation((async () => [
      { relativePath: 'assets/logo.png', draftKey: 'drafts/m/2', uploadUrl: 'https://up.test/2' },
    ]) as never);
    putSkillAssetBytes.mockImplementation((async () => undefined) as never);
    updateSkill.mockImplementation((async () => ({ data: { id: 'changed-id' } })) as never);

    await executeSkillCommand('https://api.example.test', 'project-1', {}, 'update', {
      cwd: projectRoot,
      dir,
      id: 'changed-id',
      apply: true,
    });

    expect(requestSkillAssetUploadUrls).toHaveBeenCalledTimes(1);
    const body = updateSkill.mock.calls[0][4] as { files: Record<string, unknown>[] };
    expect(body.files).toContainEqual({
      relativePath: 'assets/logo.png',
      kind: 'BINARY',
      sha256: pngSha,
      sizeBytes: pngBytes.length,
      mimeType: 'image/png',
      draftKey: 'drafts/m/2',
    });
  });
});
