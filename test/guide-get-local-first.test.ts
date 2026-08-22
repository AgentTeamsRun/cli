import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * `agentteams guide get`은 비-MCP 러너의 유일한 이름 기반 가이드 접근 경로다.
 * 자격증명은 서버 폴백에만 필요하므로, 로컬 사본이 있으면 자격증명이 깨진 세션
 * (미로그인·만료)에서도 열려야 한다. 자격증명을 선요구하던 회귀를 고정한다.
 */
const getApiConfigOrThrow = jest.fn<() => Promise<never>>();

jest.unstable_mockModule('../src/commands/convention.js', () => ({
  getApiConfigOrThrow,
}));

const { guideGet } = await import('../src/commands/guide.js');

function createTempProject(options: { withGuide: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'agentteams-guide-get-'));
  mkdirSync(join(root, '.agentteams', 'platform'), { recursive: true });
  writeFileSync(join(root, '.agentteams', 'config.json'), JSON.stringify({ projectId: 'project-1' }), 'utf-8');
  writeFileSync(
    join(root, '.agentteams', 'conventions.manifest.json'),
    JSON.stringify({ version: 1, platformGuideHashes: { 'code-review-guide.md': 'hash-1' } }),
    'utf-8',
  );
  if (options.withGuide) {
    writeFileSync(join(root, '.agentteams', 'platform', 'code-review-guide.md'), '# Code Review Guide\n', 'utf-8');
  }
  return root;
}

describe('guide get resolves the local copy before requiring credentials', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    jest.clearAllMocks();
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true });
    }
  });

  it('returns the local guide without touching credentials', async () => {
    getApiConfigOrThrow.mockRejectedValue(new Error('AgentTeams project is not configured.'));
    const root = createTempProject({ withGuide: true });
    tempRoots.push(root);

    const result = (await guideGet({ recordKind: 'code-review', cwd: root })) as {
      source: string;
      content: string;
      guideHash: string | null;
    };

    expect(result.source).toBe('local');
    expect(result.content).toBe('# Code Review Guide\n');
    expect(result.guideHash).toBe('hash-1');
    expect(getApiConfigOrThrow).not.toHaveBeenCalled();
  });

  it('still requires credentials for the server fallback when no local copy exists', async () => {
    getApiConfigOrThrow.mockRejectedValue(new Error('AgentTeams project is not configured.'));
    const root = createTempProject({ withGuide: false });
    tempRoots.push(root);

    await expect(guideGet({ recordKind: 'code-review', cwd: root })).rejects.toThrow(
      'AgentTeams project is not configured.',
    );
    expect(getApiConfigOrThrow).toHaveBeenCalledTimes(1);
  });
});
