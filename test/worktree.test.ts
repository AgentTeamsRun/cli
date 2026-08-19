import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { WorktreeLifecycleEvent } from '../src/api/worktree.js';
import {
  buildWorktreeLifecyclePayload,
  computeWorktreeLocalKey,
  createDefaultWorktreeEventId,
  parseHerdrWorktreeEvent,
  resolveCwdIdentity,
  resolveHerdrIdentity,
  scheduleDeletedEventAfterRemoval,
  waitForPathRemoval,
  type WorktreeGitReader,
} from '../src/commands/worktree.js';
import { createProgram } from '../src/program/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('worktree lifecycle identity', () => {
  it('uses the same canonical-path hash as Runner discovery', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-key-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    const canonicalPath = realpathSync(worktreePath);
    const runnerLocalKey = createHash('sha256').update(canonicalPath).digest('hex');

    expect(computeWorktreeLocalKey(worktreePath)).toBe(runnerLocalKey);
  });

  it('creates a unique default event id for every lifecycle occurrence', () => {
    const first = createDefaultWorktreeEventId('CREATED');
    const second = createDefaultWorktreeEventId('CREATED');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^orca:created:[0-9a-f-]{36}$/u);
  });

  it('marks the reporting host in the event id prefix', () => {
    expect(createDefaultWorktreeEventId('CREATED', 'herdr')).toMatch(/^herdr:created:[0-9a-f-]{36}$/u);
    expect(createDefaultWorktreeEventId('DELETED', 'herdr')).toMatch(/^herdr:deleted:[0-9a-f-]{36}$/u);
  });

  // herdr는 worktree가 삭제된 뒤에 훅을 실행한다. 그 시점에 계산한 localKey가 생성 시점과 달라지면
  // 서버가 같은 worktree로 매칭하지 못해 MISSING 전이가 실패한다.
  it('keeps the local key stable after the worktree path is removed under a symlinked parent', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-removed-key-'));
    tempDirs.push(tempDir);
    const realParent = join(tempDir, 'real-parent');
    const linkedParent = join(tempDir, 'linked-parent');
    mkdirSync(realParent);
    symlinkSync(realParent, linkedParent, 'dir');
    const worktreePath = join(linkedParent, 'linked');
    mkdirSync(worktreePath);

    const keyWhilePresent = computeWorktreeLocalKey(worktreePath);
    rmSync(worktreePath, { recursive: true });

    expect(computeWorktreeLocalKey(worktreePath)).toBe(keyWhilePresent);
  });

  // 삭제가 worktree 하나로 끝나지 않고 부모 디렉터리째 사라지는 경우가 있다. 부모 한 단계만
  // realpath하면 이때 값이 달라져 서버가 새 유령 행을 만든다.
  it('keeps the local key stable when the parent directory is removed together', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-removed-parent-'));
    tempDirs.push(tempDir);
    const realParent = join(tempDir, 'real-parent');
    const linkedParent = join(tempDir, 'linked-parent');
    mkdirSync(realParent);
    symlinkSync(realParent, linkedParent, 'dir');
    const worktreeParent = join(linkedParent, 'example');
    const worktreePath = join(worktreeParent, 'feature-a');
    mkdirSync(worktreePath, { recursive: true });

    const keyWhilePresent = computeWorktreeLocalKey(worktreePath);
    rmSync(worktreeParent, { recursive: true });

    expect(computeWorktreeLocalKey(worktreePath)).toBe(keyWhilePresent);
  });
});

// 확인 기준: herdr 0.8.0 (docs/fixtures/herdr-worktree-hooks/captured-contract.json)
const herdrCreatedPayload = {
  event: 'worktree_created',
  data: {
    type: 'worktree_created',
    workspace: {
      workspace_id: 'w1',
      worktree: {
        repo_key: '/repos/example/.git',
        repo_name: 'example',
        repo_root: '/repos/example',
        checkout_path: '/worktrees/example/feature-a',
        is_linked_worktree: true,
      },
    },
    worktree: {
      path: '/worktrees/example/feature-a',
      branch: 'feature-a',
      is_linked_worktree: true,
      label: 'example',
    },
  },
};

const herdrRemovedPayload = {
  event: 'worktree_removed',
  data: {
    type: 'worktree_removed',
    workspace_id: 'w1',
    workspace: herdrCreatedPayload.data.workspace,
    worktree: herdrCreatedPayload.data.worktree,
    forced: true,
  },
};

describe('herdr plugin event payload', () => {
  it('reads the worktree identity from a created event', () => {
    const parsed = parseHerdrWorktreeEvent(
      { HERDR_PLUGIN_EVENT: 'worktree.created', HERDR_PLUGIN_EVENT_JSON: JSON.stringify(herdrCreatedPayload) },
      'CREATED',
    );

    expect(parsed).toEqual({
      worktreePath: '/worktrees/example/feature-a',
      branch: 'feature-a',
      repoRoot: '/repos/example',
    });
  });

  it('reads the worktree identity from a removed event', () => {
    const parsed = parseHerdrWorktreeEvent(
      { HERDR_PLUGIN_EVENT: 'worktree.removed', HERDR_PLUGIN_EVENT_JSON: JSON.stringify(herdrRemovedPayload) },
      'DELETED',
    );

    expect(parsed.worktreePath).toBe('/worktrees/example/feature-a');
    expect(parsed.repoRoot).toBe('/repos/example');
  });

  it('falls back to the repo key directory when repo_root is absent', () => {
    const workspaceWorktree: Record<string, unknown> = { ...herdrCreatedPayload.data.workspace.worktree };
    delete workspaceWorktree.repo_root;
    const payload = {
      ...herdrCreatedPayload,
      data: {
        ...herdrCreatedPayload.data,
        workspace: { ...herdrCreatedPayload.data.workspace, worktree: workspaceWorktree },
      },
    };

    const parsed = parseHerdrWorktreeEvent(
      { HERDR_PLUGIN_EVENT: 'worktree.created', HERDR_PLUGIN_EVENT_JSON: JSON.stringify(payload) },
      'CREATED',
    );

    expect(parsed.repoRoot).toBe('/repos/example');
  });

  it('names the expected event when the hook environment is missing', () => {
    expect(() => parseHerdrWorktreeEvent({}, 'CREATED')).toThrow(/worktree\.created/u);
    expect(() => parseHerdrWorktreeEvent({}, 'DELETED')).toThrow(/worktree\.removed/u);
  });

  it('rejects a malformed payload', () => {
    expect(() =>
      parseHerdrWorktreeEvent({ HERDR_PLUGIN_EVENT: 'worktree.created', HERDR_PLUGIN_EVENT_JSON: '{' }, 'CREATED'),
    ).toThrow(/not valid JSON/u);
  });

  it('rejects an event of a different kind', () => {
    expect(() =>
      parseHerdrWorktreeEvent(
        { HERDR_PLUGIN_EVENT: 'worktree.removed', HERDR_PLUGIN_EVENT_JSON: JSON.stringify(herdrRemovedPayload) },
        'CREATED',
      ),
    ).toThrow(/received 'worktree\.removed'/u);
  });

  it('rejects a payload without a worktree path', () => {
    expect(() =>
      parseHerdrWorktreeEvent(
        {
          HERDR_PLUGIN_EVENT: 'worktree.created',
          HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: 'worktree_created', data: { worktree: {} } }),
        },
        'CREATED',
      ),
    ).toThrow(/worktree path/u);
  });
});

describe('delete notification delivery guard', () => {
  it('uses CREATE_NO_WINDOW without DETACHED_PROCESS on Windows', () => {
    const unref = jest.fn();
    const spawn = jest.fn(() => ({ unref }));
    const event: WorktreeLifecycleEvent = {
      event: 'DELETED',
      eventId: 'event-1',
      occurredAt: '2026-07-28T00:00:00.000Z',
      localKey: 'local-key',
    };

    scheduleDeletedEventAfterRemoval('C:\\repo\\worktree', 'C:\\repo', event, {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      entryPath: 'C:\\agentteams\\index.js',
      env: {},
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      ['C:\\agentteams\\index.js', 'worktree', 'deliver-deleted'],
      expect.objectContaining({ detached: false, windowsHide: true, stdio: 'ignore' }),
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('preserves detached process groups outside Windows', () => {
    const spawn = jest.fn(() => ({ unref: jest.fn() }));
    const event: WorktreeLifecycleEvent = {
      event: 'DELETED',
      eventId: 'event-2',
      occurredAt: '2026-07-28T00:00:00.000Z',
      localKey: 'local-key',
    };

    scheduleDeletedEventAfterRemoval('/repo/worktree', '/repo', event, {
      platform: 'linux',
      execPath: '/usr/bin/node',
      entryPath: '/agentteams/index.js',
      env: {},
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['/agentteams/index.js', 'worktree', 'deliver-deleted'],
      expect.objectContaining({ detached: true, windowsHide: true, stdio: 'ignore' }),
    );
  });

  it('delivers only after the worktree path disappears', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-remove-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    setTimeout(() => rmSync(worktreePath, { recursive: true }), 10);

    await expect(waitForPathRemoval(worktreePath, { intervalMs: 5, timeoutMs: 100 })).resolves.toBe(true);
  });

  it('does not deliver when removal fails and the path remains', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentteams-worktree-stays-'));
    tempDirs.push(tempDir);
    const worktreePath = join(tempDir, 'linked');
    mkdirSync(worktreePath);

    await expect(waitForPathRemoval(worktreePath, { intervalMs: 5, timeoutMs: 20 })).resolves.toBe(false);
  });
});

const createGitReader = (overrides: Partial<WorktreeGitReader> = {}): WorktreeGitReader => ({
  resolveTopLevel: () => null,
  resolveMainRoot: () => null,
  readRemoteOriginUrl: () => undefined,
  readGitValue: () => undefined,
  ...overrides,
});

describe('worktree identity wiring', () => {
  const createdEvent = parseHerdrWorktreeEvent(
    { HERDR_PLUGIN_EVENT: 'worktree.created', HERDR_PLUGIN_EVENT_JSON: JSON.stringify(herdrCreatedPayload) },
    'CREATED',
  );

  it('reads herdr identity from the payload, not from the hook working directory', () => {
    const remoteCwds: string[] = [];
    const gitCalls: Array<{ args: string[]; cwd: string }> = [];
    const identity = resolveHerdrIdentity(
      createdEvent,
      'CREATED',
      createGitReader({
        readRemoteOriginUrl: (cwd) => {
          remoteCwds.push(cwd);
          return 'git@github.com:example/example.git';
        },
        readGitValue: (args, cwd) => {
          gitCalls.push({ args, cwd });
          return 'head-sha';
        },
      }),
    );

    expect(identity).toEqual({
      host: 'herdr',
      worktreePath: '/worktrees/example/feature-a',
      stableCwd: '/repos/example',
      remoteUrl: 'git@github.com:example/example.git',
      branch: 'feature-a',
      headSha: 'head-sha',
    });
    // remote 조회는 worktree가 아니라 메인 체크아웃 루트 기준이다.
    expect(remoteCwds).toEqual(['/repos/example']);
    expect(gitCalls).toEqual([{ args: ['rev-parse', 'HEAD'], cwd: '/worktrees/example/feature-a' }]);
  });

  it('does not read HEAD for a herdr removed event', () => {
    const readGitValue = jest.fn(() => 'head-sha');
    const identity = resolveHerdrIdentity(
      createdEvent,
      'DELETED',
      createGitReader({ readGitValue: readGitValue as WorktreeGitReader['readGitValue'] }),
    );

    expect(identity.headSha).toBeNull();
    expect(readGitValue).not.toHaveBeenCalled();
  });

  it('leaves the remote url unset when the herdr payload carries no repository root', () => {
    const readRemoteOriginUrl = jest.fn(() => 'git@github.com:example/example.git');
    const identity = resolveHerdrIdentity(
      { worktreePath: '/worktrees/example/feature-a', branch: 'feature-a', repoRoot: null },
      'DELETED',
      createGitReader({ readRemoteOriginUrl: readRemoteOriginUrl as WorktreeGitReader['readRemoteOriginUrl'] }),
    );

    expect(identity.remoteUrl).toBeUndefined();
    expect(readRemoteOriginUrl).not.toHaveBeenCalled();
  });

  it('reads Orca identity from the current directory and reports the orca host', () => {
    const remoteCwds: string[] = [];
    const identity = resolveCwdIdentity(
      '/repos/example/nested',
      createGitReader({
        resolveTopLevel: () => '/worktrees/example/feature-a',
        resolveMainRoot: () => '/repos/example',
        readRemoteOriginUrl: (cwd) => {
          remoteCwds.push(cwd);
          return 'git@github.com:example/example.git';
        },
        readGitValue: (args) => (args[0] === 'branch' ? 'feature-a' : 'head-sha'),
      }),
    );

    expect(identity).toEqual({
      host: 'orca',
      worktreePath: '/worktrees/example/feature-a',
      stableCwd: '/repos/example',
      remoteUrl: 'git@github.com:example/example.git',
      branch: 'feature-a',
      headSha: 'head-sha',
    });
    expect(remoteCwds).toEqual(['/repos/example/nested']);
  });
});

describe('worktree lifecycle payload', () => {
  const herdrIdentity = {
    host: 'herdr' as const,
    worktreePath: '/worktrees/example/feature-a',
    stableCwd: '/repos/example',
    remoteUrl: 'git@github.com:example/example.git',
    branch: 'feature-a',
    headSha: null,
  };

  it('marks the herdr host in the event id and keys off the payload worktree path', () => {
    const payload = buildWorktreeLifecyclePayload('DELETED', herdrIdentity, {});

    expect(payload.eventId).toMatch(/^herdr:deleted:/u);
    expect(payload.localKey).toBe(computeWorktreeLocalKey('/worktrees/example/feature-a'));
    expect(payload.localKey).not.toBe(computeWorktreeLocalKey(process.cwd()));
    expect(payload).toMatchObject({
      event: 'DELETED',
      remoteUrl: 'git@github.com:example/example.git',
      branch: 'feature-a',
      headSha: null,
      displayName: 'feature-a',
    });
  });

  it('prefers an explicit repository id over the resolved remote url', () => {
    const payload = buildWorktreeLifecyclePayload('CREATED', herdrIdentity, { repositoryId: ' repo-1 ' });

    expect(payload).toMatchObject({ repositoryId: 'repo-1' });
    expect(payload.remoteUrl).toBeUndefined();
  });

  // 저장소 식별자가 없는 payload는 서버에서 WORKTREE_REPOSITORY_NOT_FOUND로만 끝나 원인을 알 수 없다.
  it('fails before sending when neither a repository id nor a remote url is available', () => {
    expect(() => buildWorktreeLifecyclePayload('DELETED', { ...herdrIdentity, remoteUrl: undefined }, {})).toThrow(
      /herdr event[\s\S]*--repository-id/u,
    );
    expect(() =>
      buildWorktreeLifecyclePayload('DELETED', { ...herdrIdentity, host: 'orca', remoteUrl: undefined }, {}),
    ).toThrow(/origin remote[\s\S]*--repository-id/u);
  });
});

describe('worktree command registration', () => {
  // 지연 삭제 전달 자식 프로세스가 실제로 실행하는 argv다. 등록이 빠지면 자식이 조용히 죽는다.
  it('registers the deliver-deleted entry point the deferred delivery child invokes', () => {
    const worktree = createProgram('0.0.0').commands.find((command) => command.name() === 'worktree');

    expect(worktree?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['notify-created', 'notify-deleted', 'deliver-deleted']),
    );
  });
});
