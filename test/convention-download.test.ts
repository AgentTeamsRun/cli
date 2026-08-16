import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conventionDownload } from '../src/commands/convention.js';

const API_URL = 'https://api.example.test';
const PROJECT_ID = 'project-1';

type RemoteConvention = {
  id: string;
  title: string;
  category: string;
  contentMarkdown: string;
  scope: string;
};

let projectRoot = '';
let conventions: RemoteConvention[] = [];

const remoteConvention = (id: string, category: string): RemoteConvention => ({
  id,
  title: `${category} convention`,
  category,
  contentMarkdown: `# ${category}\n`,
  scope: 'PROJECT',
});

const download = () =>
  conventionDownload({
    cwd: projectRoot,
    agentConfigId: 'agent-1',
    config: { projectId: PROJECT_ID, teamId: 'team-1', apiUrl: API_URL, apiKey: 'key_test' } as never,
  });

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'convention-download-'));
  mkdirSync(join(projectRoot, '.agentteams'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.agentteams', 'config.json'),
    JSON.stringify({ projectId: PROJECT_ID, teamId: 'team-1' }),
    'utf-8',
  );

  conventions = [];
  jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
    if (url.endsWith('/api/platform/guides')) return { data: { data: [] } };
    if (url.endsWith('/api/platform/guides/hash')) return { data: { data: { hash: 'aggregate-hash' } } };
    if (url.endsWith('/agent-configs/agent-1/convention')) {
      return { data: { data: { content: '# AGENT_RULES\n' } } };
    }
    if (url.endsWith('/conventions/download-all')) return { data: { data: conventions } };
    throw new Error(`unexpected GET ${url}`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('convention download stale-file cleanup', () => {
  it('removes a manifest-owned file when its last convention category disappears', async () => {
    conventions = [remoteConvention('foo-1', 'foo')];
    await download();

    const fooFile = join(projectRoot, '.agentteams', 'foo', 'foo-convention.md');
    expect(existsSync(fooFile)).toBe(true);

    conventions = [remoteConvention('bar-1', 'bar')];
    await download();

    expect(existsSync(fooFile)).toBe(false);
    expect(existsSync(join(projectRoot, '.agentteams', 'bar', 'bar-convention.md'))).toBe(true);
  });

  it('removes every manifest-owned file and clears the manifest when the server list becomes empty', async () => {
    conventions = [remoteConvention('foo-1', 'foo'), remoteConvention('bar-1', 'bar')];
    await download();

    const downloadedFiles = conventions.map((convention) =>
      join(projectRoot, '.agentteams', convention.category, `${convention.category}-convention.md`),
    );
    expect(downloadedFiles.every((file) => existsSync(file))).toBe(true);

    conventions = [];
    await download();

    expect(downloadedFiles.every((file) => !existsSync(file))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.agentteams', 'conventions.manifest.json'), 'utf-8'),
    ) as { entries: unknown[] };
    expect(manifest.entries).toEqual([]);
  });
});

describe('convention download unmanaged-file warning', () => {
  it('reports an unmanaged markdown file without changing its content', async () => {
    const unmanagedFile = join(projectRoot, '.agentteams', 'rules', 'old-ghost.md');
    mkdirSync(join(projectRoot, '.agentteams', 'rules'), { recursive: true });
    writeFileSync(unmanagedFile, '# keep me\n', 'utf-8');
    conventions = [remoteConvention('rules-1', 'rules')];

    const result = await download();

    expect(result.unmanagedFiles).toEqual(['.agentteams/rules/old-ghost.md']);
    expect(result.warning).toContain('.agentteams/rules/old-ghost.md');
    expect(readFileSync(unmanagedFile, 'utf-8')).toBe('# keep me\n');
  });

  it('omits unmanagedFiles and warning when every category markdown file is manifest-owned', async () => {
    conventions = [remoteConvention('rules-1', 'rules')];

    const result = await download();

    expect(result.unmanagedFiles).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });
});
