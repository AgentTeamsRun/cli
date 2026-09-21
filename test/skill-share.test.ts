import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { CommanderError } from 'commander';

const listSkills = jest.fn();
const downloadSkill = jest.fn();
const getSkill = jest.fn();
const createSkill = jest.fn();
const updateSkill = jest.fn();
const deleteSkill = jest.fn();
const requestSkillAssetUploadUrls = jest.fn();
const putSkillAssetBytes = jest.fn();
const fetchSkillAssetBytes = jest.fn();
const createSkillShare = jest.fn();
const revokeSkillShare = jest.fn();
const listSkillShares = jest.fn();
const listSkillInstalls = jest.fn();
const listSharedSkills = jest.fn();
const getSharedSkill = jest.fn();
const installSharedSkill = jest.fn();
const getPublicSharedSkill = jest.fn();
const installSharedSkillByToken = jest.fn();

const apiMocks = {
  listSkills,
  downloadSkill,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  requestSkillAssetUploadUrls,
  putSkillAssetBytes,
  fetchSkillAssetBytes,
  createSkillShare,
  revokeSkillShare,
  listSkillShares,
  listSkillInstalls,
  listSharedSkills,
  getSharedSkill,
  installSharedSkill,
  getPublicSharedSkill,
  installSharedSkillByToken,
};

jest.unstable_mockModule('../src/api/skill.js', () => ({ __esModule: true, ...apiMocks }));

const { executeSkillCommand } = await import('../src/commands/skill.js');
const { createProgram } = await import('../src/program/index.js');
const { CANONICAL_CLI_NAME } = await import('../src/program/invokedName.js');

const apiUrl = 'https://api.test';
const projectId = 'project-1';
const headers = { Authorization: 'Bearer token' };

const run = (action: string, options: Record<string, unknown> = {}) =>
  executeSkillCommand(apiUrl, projectId, headers, action, options);

const totalApiCalls = () => Object.values(apiMocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0);

const mutationCalls = () =>
  createSkillShare.mock.calls.length + revokeSkillShare.mock.calls.length + installSharedSkill.mock.calls.length;

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

async function renderNestedHelp(resource: string, action: string): Promise<string> {
  const program = createProgram('0.0.0', CANONICAL_CLI_NAME);
  let output = '';
  program.configureOutput({ writeOut: (text) => (output += text) });
  const configureExitOverride = (command: typeof program): void => {
    command.exitOverride();
    for (const subcommand of command.commands) configureExitOverride(subcommand);
  };
  configureExitOverride(program);

  try {
    await program.parseAsync(['node', 'agentteams', resource, action, '--help'], { from: 'node' });
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== 'commander.helpDisplayed') throw error;
  }

  return output.replace(/\s+/g, ' ');
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('skill share', () => {
  it('dry-run without --apply makes no API call and previews the upper-cased scope', async () => {
    const result = await run('share', { id: 'skill-1', scope: 'public', includeExecutable: false, allowInstall: true });

    expect(totalApiCalls()).toBe(0);
    expect(result).toMatchObject({
      dryRun: true,
      skillId: 'skill-1',
      share: {
        scope: 'PUBLIC',
        includeBody: true,
        includeExecutable: false,
        allowInstall: true,
        expiresAt: null,
      },
    });
    expect(String(result.hint)).toContain('--apply');
  });

  it('rejects an unknown scope and an invalid date before calling the server', async () => {
    await expect(run('share', { id: 'skill-1', scope: 'friends' })).rejects.toThrow(/Invalid --scope/);
    await expect(run('share', { id: 'skill-1', scope: 'link', expiresAt: 'not-a-date' })).rejects.toThrow(
      /Invalid --expires-at/,
    );
    expect(totalApiCalls()).toBe(0);
  });

  it('shares with the team without --team and sends no target team', async () => {
    const result = await run('share', { id: 'skill-1', scope: 'team' });

    expect(totalApiCalls()).toBe(0);
    expect(result).toMatchObject({ dryRun: true, skillId: 'skill-1', share: { scope: 'TEAM' } });
    expect('targetTeamId' in (result.share as Record<string, unknown>)).toBe(false);
    expect(await renderNestedHelp('skill', 'share')).not.toContain('--team ');
  });

  it('sends only the explicitly chosen options so server defaults apply to the rest', async () => {
    createSkillShare.mockImplementation((async () => ({
      data: { id: 'share-1', scope: 'TEAM', targetTeamId: 'team-1', token: null, url: null },
    })) as never);

    const result = await run('share', {
      id: 'skill-1',
      scope: 'TEAM',
      includeBody: false,
      includeExecutable: true,
      allowInstall: false,
      expiresAt: '2999-01-01T00:00:00.000Z',
      apply: true,
    });

    expect(createSkillShare).toHaveBeenCalledTimes(1);
    expect(createSkillShare).toHaveBeenCalledWith(apiUrl, projectId, headers, 'skill-1', {
      scope: 'TEAM',
      includeBody: false,
      includeExecutable: true,
      allowInstall: false,
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
    expect(result.message).toBe('Skill shared (team).');

    createSkillShare.mockImplementation((async () => ({ data: { id: 'share-2', scope: 'PUBLIC' } })) as never);
    await run('share', { id: 'skill-1', scope: 'public', includeExecutable: false, allowInstall: true, apply: true });
    expect(createSkillShare).toHaveBeenLastCalledWith(apiUrl, projectId, headers, 'skill-1', { scope: 'PUBLIC' });
  });

  it('link share prints the plain token and the public URL exactly once with a one-time notice', async () => {
    const token = 'plain-token-abc';
    const url = `https://app.test/share/skills/view?token=${token}`;
    createSkillShare.mockImplementation((async () => ({
      data: { id: 'share-link', scope: 'LINK', token, url },
    })) as never);

    const result = await run('share', { id: 'skill-1', scope: 'link', apply: true });
    const rendered = JSON.stringify(result);

    expect(createSkillShare).toHaveBeenCalledTimes(1);
    expect(createSkillShare.mock.calls[0][4]).toEqual({ scope: 'LINK' });
    expect(countOccurrences(rendered, url)).toBe(1);
    // URL 안에 토큰이 포함되므로 토큰 문자열은 data.token + data.url 두 곳, 즉 필드로는 한 번이다.
    expect(result.data.token).toBe(token);
    expect(countOccurrences(rendered, token)).toBe(2);
    expect(String(result.message)).toMatch(/cannot be retrieved again/);
    expect(String(result.message)).not.toContain(token);
  });
});

describe('skill unshare', () => {
  it('dry-run makes no API call and requires --skill', async () => {
    const result = await run('unshare', { id: 'share-1', skill: 'skill-1' });
    expect(totalApiCalls()).toBe(0);
    expect(result).toMatchObject({ dryRun: true, skillId: 'skill-1', shareId: 'share-1' });

    await expect(run('unshare', { id: 'share-1' })).rejects.toThrow(/--skill is required/);
    expect(totalApiCalls()).toBe(0);
  });

  it('revokes on the server only with --apply', async () => {
    revokeSkillShare.mockImplementation((async () => undefined) as never);
    const result = await run('unshare', { id: 'share-1', skill: 'skill-1', apply: true });
    expect(revokeSkillShare).toHaveBeenCalledWith(apiUrl, projectId, headers, 'skill-1', 'share-1');
    expect(result).toMatchObject({ revoked: true, shareId: 'share-1', skillId: 'skill-1' });
  });
});

describe('skill shares / browse', () => {
  it('shares fetches share history and install records for the skill', async () => {
    listSkillShares.mockImplementation((async () => ({ data: [{ id: 'share-1' }], meta: { total: 1 } })) as never);
    listSkillInstalls.mockImplementation((async () => ({ data: [{ id: 'install-1' }], meta: { total: 1 } })) as never);

    const result = await run('shares', { id: 'skill-1', page: '2', pageSize: '5' });

    expect(listSkillShares).toHaveBeenCalledWith(apiUrl, projectId, headers, 'skill-1', { page: 2, pageSize: 5 });
    expect(listSkillInstalls).toHaveBeenCalledWith(apiUrl, projectId, headers, 'skill-1', { page: 2, pageSize: 5 });
    expect(result).toMatchObject({
      skillId: 'skill-1',
      shares: { data: [{ id: 'share-1' }] },
      installs: { data: [{ id: 'install-1' }] },
    });
    expect(mutationCalls()).toBe(0);
  });

  it('browse forwards search and paging to the consumer project shared endpoint', async () => {
    listSharedSkills.mockImplementation((async () => ({ data: [], meta: { total: 0 } })) as never);
    await run('browse', { search: 'deploy', page: '1', pageSize: '20' });
    expect(listSharedSkills).toHaveBeenCalledWith(apiUrl, projectId, headers, {
      page: 1,
      pageSize: 20,
      search: 'deploy',
    });
    expect(mutationCalls()).toBe(0);
  });
});

describe('skill install', () => {
  const detail = (overrides: Record<string, unknown> = {}) => ({
    data: {
      id: 'share-1',
      skillId: 'skill-1',
      scope: 'PUBLIC',
      includeBody: true,
      includeExecutable: false,
      allowInstall: true,
      skill: { id: 'skill-1', slug: 'deploy-helper', title: 'Deploy helper', description: '', version: 'v3' },
      files: [
        { relativePath: 'SKILL.md', kind: 'TEXT', sizeBytes: 120, sha256: 'a' },
        { relativePath: 'references/notes.md', kind: 'TEXT', sizeBytes: 40, sha256: 'b' },
      ],
      ...overrides,
    },
  });

  it('dry-run lists the files with sizes and never calls the install mutation', async () => {
    getSharedSkill.mockImplementation((async () => detail()) as never);

    const result = await run('install', { share: 'share-1' });

    expect(getSharedSkill).toHaveBeenCalledWith(apiUrl, projectId, headers, 'share-1');
    expect(installSharedSkill).not.toHaveBeenCalled();
    expect(mutationCalls()).toBe(0);
    expect(result).toMatchObject({
      dryRun: true,
      shareId: 'share-1',
      skill: { slug: 'deploy-helper', version: 'v3' },
      files: [
        { relativePath: 'SKILL.md', sizeBytes: 120 },
        { relativePath: 'references/notes.md', sizeBytes: 40 },
      ],
    });
    expect(result.warning).toBeUndefined();
    expect(String(result.hint)).toContain('--apply');
  });

  it('adds a separate warning line when the share exposes executable files', async () => {
    getSharedSkill.mockImplementation((async () =>
      detail({
        includeExecutable: true,
        files: [
          { relativePath: 'SKILL.md', kind: 'TEXT', sizeBytes: 120, sha256: 'a' },
          { relativePath: 'scripts/run.sh', kind: 'TEXT', sizeBytes: 300, sha256: 'c' },
        ],
      })) as never);

    const result = await run('install', { share: 'share-1' });

    expect(result.files).toEqual([
      { relativePath: 'SKILL.md', sizeBytes: 120 },
      { relativePath: 'scripts/run.sh', sizeBytes: 300, executable: true },
    ]);
    expect(String(result.warning)).toMatch(/executable files/);
    expect(installSharedSkill).not.toHaveBeenCalled();
  });

  it('refuses when the share forbids installation', async () => {
    getSharedSkill.mockImplementation((async () => detail({ allowInstall: false })) as never);
    await expect(run('install', { share: 'share-1', apply: true })).rejects.toThrow(/does not allow installation/);
    expect(installSharedSkill).not.toHaveBeenCalled();
  });

  it('installs with --apply and points to skill download for the local copy', async () => {
    getSharedSkill.mockImplementation((async () => detail()) as never);
    installSharedSkill.mockImplementation((async () => ({
      data: { id: 'skill-new', slug: 'deploy-helper', version: 'v1' },
    })) as never);

    const result = await run('install', { share: 'share-1', apply: true });

    expect(installSharedSkill).toHaveBeenCalledWith(apiUrl, projectId, headers, 'share-1');
    expect(result.data).toMatchObject({ id: 'skill-new', slug: 'deploy-helper' });
    expect(String(result.message)).toContain('agentteams skill download --id skill-new');
  });

  it('requires --share', async () => {
    await expect(run('install', {})).rejects.toThrow(/--share is required/);
    expect(totalApiCalls()).toBe(0);
  });

  it('refuses when both --share and --token are given', async () => {
    await expect(run('install', { share: 'share-1', token: 'tok' })).rejects.toThrow(/either --share.*or --token/);
    expect(totalApiCalls()).toBe(0);
  });

  it('refuses before any request when the share has no entry file', async () => {
    getSharedSkill.mockImplementation((async () =>
      detail({ files: [{ relativePath: 'references/notes.md', kind: 'TEXT', sizeBytes: 40, sha256: 'b' }] })) as never);
    await expect(run('install', { share: 'share-1' })).rejects.toThrow(/excludes SKILL\.md/);
    expect(installSharedSkill).not.toHaveBeenCalled();
  });

  it('dry-runs a link share with a raw token and never touches the id endpoint', async () => {
    getPublicSharedSkill.mockImplementation((async () => ({
      data: {
        slug: 'link-skill',
        title: 'Link skill',
        description: '',
        version: 'v1',
        includeBody: true,
        includeExecutable: false,
        allowInstall: true,
        files: [{ relativePath: 'SKILL.md', kind: 'TEXT', sizeBytes: 120, sha256: 'a' }],
      },
    })) as never);

    const result = await run('install', { token: 'link-token-1' });

    expect(getPublicSharedSkill).toHaveBeenCalledWith(apiUrl, 'link-token-1');
    expect(getSharedSkill).not.toHaveBeenCalled();
    expect(installSharedSkillByToken).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, skill: { slug: 'link-skill' } });
  });

  it('extracts the token from a full share URL', async () => {
    getPublicSharedSkill.mockImplementation((async () => ({
      data: {
        slug: 'link-skill',
        title: 'Link skill',
        description: '',
        version: 'v1',
        includeBody: true,
        includeExecutable: false,
        allowInstall: true,
        files: [{ relativePath: 'SKILL.md', kind: 'TEXT', sizeBytes: 120, sha256: 'a' }],
      },
    })) as never);
    installSharedSkillByToken.mockImplementation((async () => ({
      data: { id: 'skill-new', slug: 'link-skill', version: 'v1' },
    })) as never);

    const result = await run('install', {
      token: 'https://portal.example.test/share/skills/view?token=link-token-2',
      apply: true,
    });

    expect(getPublicSharedSkill).toHaveBeenCalledWith(apiUrl, 'link-token-2');
    expect(installSharedSkillByToken).toHaveBeenCalledWith(apiUrl, projectId, headers, 'link-token-2');
    expect(String(result.message)).toContain("'link-skill'");
  });

  it('rejects a share URL without a token query', async () => {
    await expect(run('install', { token: 'https://portal.example.test/share/skills/view' })).rejects.toThrow(
      /\?token=/,
    );
    expect(totalApiCalls()).toBe(0);
  });
});

describe('skill share help', () => {
  it.each([
    ['share', ['--id <id>', '--scope <scope>', '--no-include-body', '--include-executable']],
    ['share', ['--no-allow-install', '--expires-at <iso8601>', '--apply']],
    ['unshare', ['--id <shareId>', '--skill <skillId>', '--apply']],
    ['shares', ['--id <id>', '--page <number>', '--page-size <number>']],
    ['browse', ['--search <keyword>', '--page <number>', '--page-size <number>']],
    ['install', ['--share <shareId>', '--apply']],
  ])('skill %s --help lists its options', async (action, flags) => {
    const help = await renderNestedHelp('skill', action);
    for (const flag of flags) expect(help).toContain(flag);
  });
});
