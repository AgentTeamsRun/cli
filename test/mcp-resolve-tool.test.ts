import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildToolCatalog,
  getContextToolDefinitions,
  getContextToolSpecs,
  getToolNamesForProfile,
  measureToolDefinitionBudget,
} from '@agentteams/context-tools';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import axios from 'axios';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpToolContext } from '../src/commands/mcp.js';
import { getLocalToolSpecs } from '../src/mcp/localTools.js';
import { getWriteToolSpecs } from '../src/mcp/writeTools.js';
import { parseEntityRef } from '../src/utils/entityRef.js';
import { connect, discover, MODERN_META, TEST_TOOL_CONTEXT } from './helpers/mcp.js';

const { apiUrl, projectId, headers } = TEST_TOOL_CONTEXT;
const projectUrl = `${apiUrl}/api/projects/${projectId}`;
const uuid = 'f62762fc-730a-4201-8586-e2541505ed1b';
const childUuid = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

const payload = { data: { id: uuid, title: 'resolved' } };

/**
 * Every reference form the tool accepts, paired with the single HTTP call it is
 * allowed to make. The URL *is* the dispatch assertion: it names which read tool
 * (or direct API function) the handler picked, which is what this suite is for —
 * pure parsing already has its own coverage in `entity-ref.test.ts`.
 */
const DISPATCH_CASES: Array<{
  label: string;
  ref: string;
  refType: string;
  id: string;
  parentId?: string;
  url: string;
  params?: Record<string, string>;
}> = [
  // Bare prefixed ids — one per prefix code in the descriptor registry.
  {
    label: 'pln',
    ref: `agentteams_pln_${uuid}`,
    refType: 'plan',
    id: uuid,
    url: `${projectUrl}/plans/${uuid}/runbook`,
  },
  {
    label: 'rpt',
    ref: `agentteams_rpt_${uuid}`,
    refType: 'completionReport',
    id: uuid,
    url: `${projectUrl}/completion-reports/${uuid}`,
  },
  {
    label: 'pmt',
    ref: `agentteams_pmt_${uuid}`,
    refType: 'postMortem',
    id: uuid,
    url: `${projectUrl}/post-mortems/${uuid}`,
  },
  {
    label: 'act',
    ref: `agentteams_act_${uuid}`,
    refType: 'coAction',
    id: uuid,
    url: `${projectUrl}/co-actions/${uuid}`,
  },
  {
    label: 'doc',
    ref: `agentteams_doc_${uuid}`,
    refType: 'document',
    id: uuid,
    url: `${projectUrl}/documents/${uuid}`,
  },
  {
    label: 'rev',
    ref: `agentteams_rev_${uuid}`,
    refType: 'codeReview',
    id: uuid,
    url: `${projectUrl}/code-reviews/${uuid}`,
  },
  {
    label: 'rvf',
    ref: `agentteams_rvf_${uuid}`,
    refType: 'codeReviewFinding',
    id: uuid,
    url: `${projectUrl}/code-reviews/findings/${uuid}`,
  },
  {
    label: 'tsk',
    ref: `agentteams_tsk_${uuid}`,
    refType: 'planTask',
    id: uuid,
    url: `${projectUrl}/plans/tasks/${uuid}`,
  },
  {
    label: 'cnv',
    ref: `agentteams_cnv_${uuid}`,
    refType: 'convention',
    id: uuid,
    url: `${projectUrl}/conventions/${uuid}`,
  },
  // type:id, three-part parent:child, and the wrapping layers.
  {
    label: 'type:id',
    ref: `plan:agentteams_pln_${uuid}`,
    refType: 'plan',
    id: uuid,
    url: `${projectUrl}/plans/${uuid}/runbook`,
  },
  {
    label: 'convention:id (no path)',
    ref: `convention:${uuid}`,
    refType: 'convention',
    id: uuid,
    url: `${projectUrl}/conventions/${uuid}`,
  },
  {
    label: 'codeReview:R:F',
    ref: `codeReview:agentteams_rev_${uuid}:agentteams_rvf_${childUuid}`,
    refType: 'codeReviewFinding',
    id: childUuid,
    parentId: uuid,
    url: `${projectUrl}/code-reviews/findings/${childUuid}`,
    params: { codeReviewId: uuid },
  },
  {
    label: 'plan:P:T',
    ref: `plan:${uuid}:agentteams_tsk_${childUuid}`,
    refType: 'planTask',
    id: childUuid,
    parentId: uuid,
    url: `${projectUrl}/plans/tasks/${childUuid}`,
    params: { planId: uuid },
  },
  {
    label: 'LINEAR_ISSUE',
    ref: `LINEAR_ISSUE:${uuid}`,
    refType: 'LINEAR_ISSUE',
    id: uuid,
    url: `${apiUrl}/api/linear/issues/${uuid}`,
    // The Linear route reads the project from the token first and this query
    // second; a personal-token MCP session has no project on the token, so
    // dropping the query turns every Linear reference into a 401.
    params: { projectId },
  },
  {
    // 토큰이 나르는 건 Sentry의 숫자 ID뿐이라 그것만으로 permalink를 만들 수 없다. 이 경로가
    // 서버 바인딩 검증을 거쳐 저장된 permalink를 돌려주므로, 링크를 지어낼 이유 자체가 없다.
    label: 'SENTRY_ISSUE',
    ref: 'SENTRY_ISSUE:12345',
    refType: 'SENTRY_ISSUE',
    id: '12345',
    url: `${projectUrl}/sentry/issues/12345`,
  },
  {
    label: 'markdown link wrapping',
    ref: `[Safari pull-to-refresh](plan:agentteams_pln_${uuid})`,
    refType: 'plan',
    id: uuid,
    url: `${projectUrl}/plans/${uuid}/runbook`,
  },
  {
    label: 'editor sentinel url wrapping',
    ref: `[Safari](https://__entity_ref__/${encodeURIComponent(`plan:agentteams_pln_${uuid}`)})`,
    refType: 'plan',
    id: uuid,
    url: `${projectUrl}/plans/${uuid}/runbook`,
  },
];

/** Every external marker type, all of which must resolve without leaving the process. */
const EXTERNAL_CASES: Array<{ ref: string; refType: string; url?: string; suggestedCommand?: string }> = [
  {
    ref: 'GITHUB_ISSUE:owner/repo#12',
    refType: 'GITHUB_ISSUE',
    url: 'https://github.com/owner/repo/issues/12',
    suggestedCommand: 'gh issue view 12 --repo owner/repo',
  },
  {
    ref: 'GITHUB_PR:owner/repo#34',
    refType: 'GITHUB_PR',
    url: 'https://github.com/owner/repo/pull/34',
    suggestedCommand: 'gh pr view 34 --repo owner/repo',
  },
  {
    ref: 'GITLAB_ISSUE:group/project#7',
    refType: 'GITLAB_ISSUE',
    suggestedCommand: 'glab issue view 7 --repo group/project',
  },
  {
    ref: 'GITLAB_MERGE_REQUEST:group/project!9',
    refType: 'GITLAB_MERGE_REQUEST',
    suggestedCommand: 'glab mr view 9 --repo group/project',
  },
  {
    ref: 'BITBUCKET_ISSUE:owner/repo#3',
    refType: 'BITBUCKET_ISSUE',
    url: 'https://bitbucket.org/owner/repo/issues/3',
  },
  {
    ref: 'BITBUCKET_PR:owner/repo#5',
    refType: 'BITBUCKET_PR',
    url: 'https://bitbucket.org/owner/repo/pull-requests/5',
  },
];

const ERROR_CASES: Array<{ label: string; ref: string; expected: RegExp }> = [
  { label: 'unknown id prefix', ref: `agentteams_zzz_${uuid}`, expected: /unknown id prefix agentteams_zzz_/ },
  { label: 'unknown reference type', ref: `sprint:${uuid}`, expected: /unknown reference type "sprint"/ },
  { label: 'id that is not a uuid', ref: 'plan:not-a-uuid', expected: /is not a valid plan id \(expected a UUID\)/ },
  { label: 'parent id that is not a uuid', ref: `codeReview:nope:${uuid}`, expected: /is not a valid parent id/ },
  { label: 'blank reference', ref: '   ', expected: /empty reference/ },
  { label: 'a reference with no type', ref: 'nonsense', expected: /Supported forms/ },
];

describe('agentteams_resolve MCP tool', () => {
  let openHandle: StdioServerHandle | undefined;

  afterEach(async () => {
    await openHandle?.close();
    openHandle = undefined;
    jest.restoreAllMocks();
  });

  async function callResolve(ref: string) {
    const { client, handle } = connect();
    openHandle = handle;
    await discover(client);
    return client.request('tools/call', {
      name: 'agentteams_resolve',
      arguments: { ref },
      _meta: MODERN_META,
    });
  }

  it.each(DISPATCH_CASES)('$label resolves to $refType through exactly one endpoint', async (testCase) => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload } as never);

    const call = await callResolve(testCase.ref);

    expect(call.error).toBeUndefined();
    expect(call.result?.isError).toBeFalsy();
    const result = JSON.parse(call.result?.content[0].text);

    // The type detection has to agree with the CLI command's, which is the same
    // `parseEntityRef` call; only `kind` is remapped (see below).
    const parsed = parseEntityRef(testCase.ref);
    expect({ refType: result.refType, id: result.id, parentId: result.parentId }).toEqual({
      refType: parsed.refType,
      id: parsed.id,
      parentId: parsed.parentId,
    });
    expect(result.refType).toBe(testCase.refType);
    expect(result.id).toBe(testCase.id);
    expect(result.fallbackCommand).toBe(parsed.fallbackCommand);
    // MCP has no filesystem contract, so a body-bearing `file` reference is
    // inlined as a `record` instead of being downloaded.
    expect(result.kind).toBe('record');
    expect(result.record).toEqual(payload);
    expect(result.filePath).toBeUndefined();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(testCase.url, {
      headers,
      ...(testCase.params ? { params: testCase.params } : {}),
    });
  });

  it.each(EXTERNAL_CASES)('$ref resolves without any HTTP call', async (testCase) => {
    // Any client call at all is a failure here, so the stub throws rather than
    // returning a fixture that would let the assertion pass by accident.
    const getSpy = jest.spyOn(axios, 'get').mockImplementation(() => {
      throw new Error('resolve must not reach the network for an external reference');
    });

    const call = await callResolve(testCase.ref);

    expect(call.result?.isError).toBeFalsy();
    const result = JSON.parse(call.result?.content[0].text);
    expect(result.kind).toBe('external');
    expect(result.refType).toBe(testCase.refType);
    expect(result.url).toBe(testCase.url);
    expect(result.suggestedCommand).toBe(testCase.suggestedCommand);
    expect(result.record).toBeUndefined();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns the relative path only, when the session is bound to no local checkout', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockImplementation(() => {
      throw new Error('resolve must not reach the network for a convention path reference');
    });

    const call = await callResolve(`convention:${uuid}:.agentteams/rules/context.md`);

    const result = JSON.parse(call.result?.content[0].text);
    expect(result).toMatchObject({
      kind: 'localFile',
      refType: 'convention',
      id: uuid,
      path: '.agentteams/rules/context.md',
    });
    // With no verified project root there is nothing to anchor the path to, and
    // guessing the agent's cwd is exactly what would read the wrong repository.
    expect(result.filePath).toBeUndefined();
    expect(result.message).toMatch(/relative to the project root/);
    // The host agent reads the file; the tool only names it.
    expect(result.record).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('AGENT_RULES');
    expect(getSpy).not.toHaveBeenCalled();
  });

  describe('with a bound local checkout', () => {
    const roots: string[] = [];

    afterEach(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function boundContext(): { context: McpToolContext; root: string } {
      const root = mkdtempSync(join(tmpdir(), 'mcp-resolve-root-'));
      roots.push(root);
      return { context: { ...TEST_TOOL_CONTEXT, projectRoot: root }, root };
    }

    async function callBound(ref: string, context: McpToolContext) {
      const { client, handle } = connect(context);
      openHandle = handle;
      await discover(client);
      const call = await client.request('tools/call', {
        name: 'agentteams_resolve',
        arguments: { ref },
        _meta: MODERN_META,
      });
      return JSON.parse(call.result?.content[0].text);
    }

    it('anchors the path to the project root so the agent cannot read another repository', async () => {
      const getSpy = jest.spyOn(axios, 'get').mockImplementation(() => {
        throw new Error('resolve must not reach the network for a present convention file');
      });
      const { context, root } = boundContext();
      mkdirSync(join(root, '.agentteams', 'rules'), { recursive: true });
      writeFileSync(join(root, '.agentteams', 'rules', 'context.md'), '# AGENT_RULES\n', 'utf-8');

      const result = await callBound(`convention:${uuid}:.agentteams/rules/context.md`, context);

      expect(result).toMatchObject({
        kind: 'localFile',
        path: '.agentteams/rules/context.md',
        filePath: join(root, '.agentteams', 'rules', 'context.md'),
      });
      // Naming the file is the whole job — the body still never leaves disk.
      expect(JSON.stringify(result)).not.toContain('AGENT_RULES');
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('degrades a convention that was never downloaded to the server record', async () => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload } as never);
      const { context } = boundContext();

      const result = await callBound(`convention:${uuid}:.agentteams/rules/context.md`, context);

      // Same safety net as `agentteams resolve`: a missing local copy must reach
      // the server record, not hand the agent a path that does not exist.
      expect(result.kind).toBe('record');
      expect(result.record).toEqual(payload);
      expect(result.filePath).toBeUndefined();
      expect(result.message).toMatch(/Local path not found/);
      expect(getSpy).toHaveBeenCalledWith(`${projectUrl}/conventions/${uuid}`, { headers });
    });

    it('still degrades an escaping path without touching the filesystem base', async () => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload } as never);
      const { context, root } = boundContext();
      writeFileSync(join(root, 'secret.txt'), 'secret', 'utf-8');

      const result = await callBound(`convention:${uuid}:.agentteams/../secret.txt`, context);

      expect(result.kind).toBe('record');
      expect(result.path).toBeUndefined();
      expect(result.filePath).toBeUndefined();
      expect(result.message).toMatch(/Path outside/);
      expect(getSpy).toHaveBeenCalledWith(`${projectUrl}/conventions/${uuid}`, { headers });
    });
  });

  it.each(['../secret.txt', '.agentteams/../secret.txt', '/etc/passwd', 'C:\\secret.txt'])(
    'degrades the escaping path %s to the server record instead of naming a local file',
    async (path) => {
      const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload } as never);

      const call = await callResolve(`convention:${uuid}:${path}`);

      const result = JSON.parse(call.result?.content[0].text);
      expect(result.kind).toBe('record');
      expect(result.path).toBeUndefined();
      expect(getSpy).toHaveBeenCalledWith(`${projectUrl}/conventions/${uuid}`, { headers });
    },
  );

  it.each(ERROR_CASES)('reports $label as a tool error carrying the parser message', async (testCase) => {
    const getSpy = jest.spyOn(axios, 'get').mockImplementation(() => {
      throw new Error('a rejected reference must never reach the network');
    });

    const call = await callResolve(testCase.ref);

    expect(call.result?.isError).toBe(true);
    expect(call.result?.content[0].text).toMatch(testCase.expected);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty ref at the schema, before the handler runs', async () => {
    const getSpy = jest.spyOn(axios, 'get');

    const call = await callResolve('');

    // Schema rejection is a JSON-RPC error, not the handler's isError envelope.
    expect(call.error ?? call.result?.isError).toBeTruthy();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('keeps serving after a reference resolves to an upstream failure', async () => {
    const failure = Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404, data: { message: 'not found' } },
    });
    const getSpy = jest.spyOn(axios, 'get').mockRejectedValueOnce(failure as never);
    getSpy.mockResolvedValue({ data: payload } as never);

    const { client, handle } = connect();
    openHandle = handle;
    await discover(client);
    const failed = await client.request('tools/call', {
      name: 'agentteams_resolve',
      arguments: { ref: `agentteams_pln_${uuid}` },
      _meta: MODERN_META,
    });
    const recovered = await client.request('tools/call', {
      name: 'agentteams_resolve',
      arguments: { ref: `agentteams_pln_${uuid}` },
      _meta: MODERN_META,
    });

    expect(failed.result?.isError).toBe(true);
    expect(recovered.result?.isError).toBeFalsy();
  });

  it('is advertised in the full profile only, and costs 1,715 definition chars', () => {
    const readSpecs = getContextToolSpecs();
    const localSpecs = getLocalToolSpecs();
    const writeSpecs = getWriteToolSpecs();
    const definitionOf = (spec: (typeof localSpecs)[number]) => ({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: z.toJSONSchema(spec.inputSchema),
    });
    const catalog = buildToolCatalog([
      { kind: 'read', specs: readSpecs },
      { kind: 'read', specs: localSpecs },
      { kind: 'write', specs: writeSpecs },
    ]);

    expect(getToolNamesForProfile(catalog, 'full')).toContain('agentteams_resolve');
    for (const profile of ['read', 'documents', 'comments', 'minimal'] as const) {
      expect(getToolNamesForProfile(catalog, profile)).not.toContain('agentteams_resolve');
    }

    const allDefinitions = [
      ...getContextToolDefinitions(),
      ...[...localSpecs, ...writeSpecs].map((spec) => definitionOf(spec)),
    ];
    const withResolve = measureToolDefinitionBudget(allDefinitions);
    const withoutResolve = measureToolDefinitionBudget(
      allDefinitions.filter(({ name }) => name !== 'agentteams_resolve'),
    );
    const delta = withResolve.totalChars - withoutResolve.totalChars;

    // Measured 2026-08-16, after the co-action create contract gained optional
    // traceability ids and post-mortem create gained standalone incident support.
    // Updated 2026-08-17 after adding code-review and finding write tools (stage 4).
    // Updated 2026-08-22 after `SENTRY_ISSUE:<numeric-id>` joined the supported ref
    // forms (+27 chars) — that entry is what let convention.md drop its Sentry
    // permalink prose, so the cost belongs here rather than in the always-on file.
    // Updated again the same day: `agentteams_guide_get` opened from 5 record kinds to
    // all 19 (+411 chars in `full`), which is what let the 1,846-char routing table
    // leave the always-on file. Net across the two surfaces is strongly negative.
    // Updated 2026-08-23 after skill ids gained their canonical `agentteams_skl_`
    // prefix description (+28 chars in `full`; resolve itself is unchanged).
    // This is the number that decided the profile membership above: 1.7k chars is
    // cheap in `full` and a 50% jump in `minimal` (3.4k), which is why `minimal`
    // does not carry it.
    expect(delta).toBe(1_715);
    expect(withResolve.totalChars).toBe(66_445);
    process.stderr.write(`[agentteams_resolve budget] ${JSON.stringify({ delta, full: withResolve.totalChars })}\n`);
  });
});
