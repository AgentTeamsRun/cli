import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/program/index.js';

let root: string;
let server: Server;
let originalEnv: NodeJS.ProcessEnv;
let originalCwd: string;
let packages: { id: string; slug: string; version: string; files: { relativePath: string; content: string }[] }[];
let output: string[];
const canonical = '.agentteams/skills/example/SKILL.md';
const mirror = '.agents/skills/example/SKILL.md';
const manifest = '.agentteams/skills.manifest.json';
const run = async (...args: string[]) => {
  output = [];
  await createProgram('0.0.0').parseAsync(['node', 'agentteams', 'skill', 'download', '--cwd', root, ...args]);
  return JSON.parse(output.join('\n'));
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'skill-http-'));
  originalEnv = process.env;
  originalCwd = process.cwd();
  packages = [
    { id: 'example-id', slug: 'example', version: 'v1', files: [{ relativePath: 'SKILL.md', content: '원본' }] },
  ];
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/api/projects/fixture-project/skills') {
      response.end(
        JSON.stringify({
          data: packages.map(({ id, slug, version }) => ({ id, slug, version })),
          meta: { totalPages: 1 },
        }),
      );
    } else {
      const match = packages.find((item) => path === `/api/projects/fixture-project/skills/${item.id}/download`);
      response.statusCode = match ? 200 : 404;
      response.end(JSON.stringify({ data: match }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('임시 서버 주소 없음');
  process.env = {
    ...originalEnv,
    AGENTTEAMS_API_URL: `http://127.0.0.1:${address.port}`,
    AGENTTEAMS_API_KEY: 'fixture-only',
    AGENTTEAMS_PROJECT_ID: 'fixture-project',
    AGENTTEAMS_TEAM_ID: 'fixture-team',
  };
  delete process.env.AGENTTEAMS_RUNNER_TYPE;
  mkdirSync(join(root, '.agentteams'));
  writeFileSync(
    join(root, '.agentteams/config.json'),
    JSON.stringify({ projectId: 'fixture-project', teamId: 'fixture-team' }),
  );
  process.chdir(root);
  jest.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`CLI exit ${code}`);
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  process.env = originalEnv;
  process.chdir(originalCwd);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(root, { recursive: true, force: true });
});

describe('CLI 파서와 임시 HTTP 패키지 서버', () => {
  it('반복 다운로드·실패 후 재실행·미러 축소·서버 삭제를 실제 옵션으로 수행한다', async () => {
    expect((await run()).downloaded).toHaveLength(1);
    expect((await run()).conflicts).toEqual([]);
    const before = readFileSync(join(root, manifest), 'utf8');
    packages[0].files.push({ relativePath: '../escape', content: '잘못된 응답' });
    await expect(run()).rejects.toThrow('CLI exit 1');
    expect(readFileSync(join(root, manifest), 'utf8')).toBe(before);
    packages[0].files = [{ relativePath: 'SKILL.md', content: '업데이트' }];
    packages[0].version = 'v2';
    await run('--skill-targets', 'none');
    expect(readFileSync(join(root, canonical), 'utf8')).toBe('업데이트');
    expect(existsSync(join(root, mirror))).toBe(false);
    packages = [];
    expect((await run()).removed).toEqual(['example']);
    expect(existsSync(join(root, canonical))).toBe(false);
  });

  it('v1 충돌을 출력 파일에 남기며 --id --force 이후 v2로 이행한다', async () => {
    await run();
    const legacy = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    legacy.version = 1;
    delete legacy.entries[0].fileHashes;
    writeFileSync(join(root, manifest), JSON.stringify(legacy));
    writeFileSync(join(root, canonical), '사용자 비공개 편집');
    const resultFile = join(root, 'result.json');
    output = [];
    await createProgram('0.0.0').parseAsync(['node', 'agentteams', 'skill', 'download', '--output-file', resultFile]);
    expect(JSON.parse(readFileSync(resultFile, 'utf8')).conflicts).toHaveLength(1);
    expect(output.join('\n')).toContain(canonical);
    expect(output.join('\n')).not.toContain('사용자 비공개 편집');
    await expect(run('--force')).rejects.toThrow('CLI exit 1');
    await run('--id', 'example-id', '--force');
    expect(JSON.parse(readFileSync(join(root, manifest), 'utf8')).version).toBe(2);
    expect(readFileSync(join(root, canonical), 'utf8')).toBe('원본');
    expect((await run()).conflicts).toEqual([]);
  });
  it('--force --all로 여러 v1 패키지를 명시적으로 일괄 이행한다', async () => {
    packages.push({
      id: 'second-id',
      slug: 'second',
      version: 'v1',
      files: [{ relativePath: 'SKILL.md', content: '두 번째' }],
    });
    await run();
    const legacy = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    legacy.version = 1;
    for (const entry of legacy.entries) delete entry.fileHashes;
    writeFileSync(join(root, manifest), JSON.stringify(legacy));
    expect((await run()).conflicts).toHaveLength(2);
    await expect(run('--all')).rejects.toThrow('CLI exit 1');
    await expect(run('--id', 'example-id', '--force', '--all')).rejects.toThrow('CLI exit 1');
    const result = await run('--force', '--all');
    expect(result.downloaded).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(
      JSON.parse(readFileSync(join(root, manifest), 'utf8')).entries.every(
        (entry: { fileHashes?: Record<string, string> }) => entry.fileHashes,
      ),
    ).toBe(true);
  });

  it('남은 잠금은 명시적으로 해제하고 실행 중인 PID의 잠금은 보존한다', async () => {
    const lock = join(root, '.agentteams/skills.sync.lock');
    writeFileSync(lock, '');
    await expect(run()).rejects.toThrow('CLI exit 1');
    expect((await run('--release-lock')).released).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect((await run()).downloaded).toHaveLength(1);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    await expect(run('--release-lock')).rejects.toThrow('CLI exit 1');
    expect(existsSync(lock)).toBe(true);
  });
});
