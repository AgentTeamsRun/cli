import { describe, expect, it, jest } from '@jest/globals';
import {
  CONTEXT_TOOL_SEARCH_TYPES,
  executeContextTool,
  getContextToolSpecs,
  stripContextEntityIdPrefix,
  type ContextToolsClient,
} from '@agentteams/context-tools';
import { z } from 'zod';
import { stripEntityIdPrefix } from '../src/utils/entityId.js';
import { VALID_TYPES } from '../src/utils/searchParams.js';

const expectedContract = [
  { name: 'agentteams_search', required: ['query'], properties: ['limit', 'maxTokens', 'query', 'types'] },
  {
    name: 'agentteams_plan_list',
    required: [],
    properties: [
      'assignedTo',
      'createdByMemberId',
      'dateFrom',
      'dateTo',
      'page',
      'pageSize',
      'priority',
      'search',
      'status',
      'title',
      'type',
    ],
  },
  { name: 'agentteams_plan_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_report_list',
    required: [],
    properties: [
      'createdByMemberId',
      'dateFrom',
      'dateTo',
      'page',
      'pageSize',
      'planId',
      'reviewStatus',
      'search',
      'status',
    ],
  },
  { name: 'agentteams_report_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_coaction_list',
    required: [],
    properties: [
      'createdByMemberId',
      'dateFrom',
      'dateTo',
      'page',
      'pageSize',
      'search',
      'source',
      'status',
      'visibility',
    ],
  },
  { name: 'agentteams_coaction_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_postmortem_list',
    required: [],
    properties: ['createdByMemberId', 'dateFrom', 'dateTo', 'page', 'pageSize', 'planId', 'search', 'status'],
  },
  { name: 'agentteams_postmortem_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_document_list',
    required: [],
    properties: [
      'archived',
      'createdByMemberId',
      'favorite',
      'page',
      'pageSize',
      'q',
      'tagPrefix',
      'tags',
      'untagged',
      'visibility',
    ],
  },
  { name: 'agentteams_document_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_convention_list',
    required: [],
    properties: ['archived', 'category', 'createdByMemberId', 'page', 'pageSize', 'scope', 'search'],
  },
  { name: 'agentteams_convention_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_codereview_list',
    required: [],
    properties: [
      'createdByMemberId',
      'dateFrom',
      'dateTo',
      'page',
      'pageSize',
      'search',
      'severity',
      'sourceCompletionReportId',
      'sourcePlanId',
      'status',
      'targetType',
    ],
  },
  { name: 'agentteams_codereview_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_comment_list',
    required: [],
    properties: ['documentId', 'findingId', 'order', 'page', 'pageSize', 'planId', 'taskId', 'type'],
  },
  { name: 'agentteams_comment_get', required: ['id'], properties: ['id'] },
  {
    name: 'agentteams_comment_reply_list',
    required: ['commentId'],
    properties: ['commentId', 'order', 'page', 'pageSize'],
  },
  { name: 'agentteams_comment_reply_get', required: ['replyId'], properties: ['replyId'] },
  {
    name: 'agentteams_codereview_finding_list',
    required: ['codeReviewId'],
    properties: ['codeReviewId', 'page', 'pageSize'],
  },
  {
    name: 'agentteams_codereview_finding_get',
    required: ['id'],
    properties: ['codeReviewId', 'id'],
  },
];

describe('shared context-tools contract', () => {
  it('keeps the published tool names and input shapes unchanged', () => {
    const actual = getContextToolSpecs().map((spec) => {
      const schema = z.toJSONSchema(spec.inputSchema) as {
        anyOf?: {
          properties?: Record<string, unknown>;
          required?: string[];
        }[];
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const properties = new Set(Object.keys(schema.properties ?? {}));
      for (const variant of schema.anyOf ?? []) {
        for (const property of Object.keys(variant.properties ?? {})) {
          properties.add(property);
        }
      }
      return {
        name: spec.name,
        required: [...(schema.required ?? [])].sort(),
        properties: [...properties].sort(),
      };
    });

    expect(actual).toEqual(expectedContract);
    expect(new Set(actual.map(({ name }) => name)).size).toBe(actual.length);
    expect(actual.filter(({ name }) => name === 'agentteams_codereview_get')).toHaveLength(1);
    expect(actual.some(({ name }) => name === 'agentteams_code_review_get')).toBe(false);
  });

  it('keeps the search type catalog unchanged', () => {
    const search = getContextToolSpecs()[0];
    const schema = z.toJSONSchema(search.inputSchema) as {
      properties?: { types?: { items?: { enum?: string[] } } };
    };

    expect(VALID_TYPES).toBe(CONTEXT_TOOL_SEARCH_TYPES);
    expect(schema.properties?.types?.items?.enum).toEqual(CONTEXT_TOOL_SEARCH_TYPES);
    expect(CONTEXT_TOOL_SEARCH_TYPES).toContain('SENTRY_ISSUE');
  });

  it('uses the shared entity id prefix normalizer', () => {
    const fixtures: unknown[] = [
      'agentteams_pln_fixture-id',
      'agentteams_rpt_fixture-id',
      'agentteams_rvf_fixture-id',
      'bare-id',
      undefined,
      42,
    ];

    for (const fixture of fixtures) {
      expect(stripEntityIdPrefix(fixture)).toBe(stripContextEntityIdPrefix(fixture));
    }
  });

  it('describes exact list pagination separately from relevance search', () => {
    const specs = getContextToolSpecs();
    const listSpecs = specs.filter(({ name }) => name.endsWith('_list'));

    expect(listSpecs).toHaveLength(10);
    for (const spec of listSpecs) {
      expect(spec.description).toContain('one page');
      expect(spec.description).toContain('meta.total');
      expect(spec.description).toContain('meta.totalPages');
      expect(spec.description).toContain('agentteams_search');
      if (spec.name === 'agentteams_codereview_finding_list') {
        expect(spec.description).toContain('finding body');
        expect(spec.description).not.toContain('metadata-only');
      } else {
        expect(spec.description).toContain('metadata-only');
      }
    }

    expect(specs.find(({ name }) => name === 'agentteams_search')?.description).toContain('topic and relevance');
    expect(specs.find(({ name }) => name === 'agentteams_search')?.description).toContain('exact filtered count');
  });

  it('describes one shared project binding for every search, list, and get tool', () => {
    const readSpecs = getContextToolSpecs().filter(
      ({ name }) => name === 'agentteams_search' || name.endsWith('_list') || name.endsWith('_get'),
    );

    expect(readSpecs).toHaveLength(21);
    for (const spec of readSpecs) {
      expect(spec.description).toContain('project bound to the current MCP server or context client');
      expect(spec.description).toContain('cannot read another project');
      expect(spec.description).not.toContain('projectId configured for this CLI');
    }
  });

  it('matches enum, date, boolean, tag, and pagination boundaries from the API query schemas', () => {
    const schemas = Object.fromEntries(
      getContextToolSpecs().map((spec) => [spec.name, z.toJSONSchema(spec.inputSchema)]),
    ) as Record<string, { properties?: Record<string, any> }>;

    expect(schemas.agentteams_plan_list.properties?.status.enum).toEqual([
      'BACKLOG',
      'TODO',
      'ASSIGNED',
      'IN_PROGRESS',
      'PARTIAL',
      'DONE',
      'BLOCKED',
      'CANCELLED',
    ]);
    expect(schemas.agentteams_plan_list.properties?.dateFrom.format).toBe('date');
    expect(schemas.agentteams_codereview_list.properties?.targetType.enum).toEqual([
      'BRANCH_DIFF',
      'GITHUB_PR',
      'GITLAB_MR',
      'BITBUCKET_PR',
      'LOCAL_DIFF',
      'UPLOADED_DIFF',
      'COMMIT_RANGE',
    ]);
    expect(schemas.agentteams_document_list.properties?.untagged.type).toBe('boolean');
    expect(schemas.agentteams_document_list.properties?.favorite.type).toBe('boolean');
    expect(schemas.agentteams_document_list.properties?.tags.type).toBe('array');
    expect(schemas.agentteams_document_list.properties?.tags.minItems).toBe(1);
    expect(schemas.agentteams_document_list.properties?.tags.items.minLength).toBe(1);
    expect(schemas.agentteams_document_list.properties?.page.minimum).toBe(0);
    expect(schemas.agentteams_document_list.properties?.pageSize.maximum).toBe(100);
  });

  it('preserves explicit false and zero values while omitting undefined list filters', async () => {
    const listDocuments = jest.fn(async () => ({ data: [], meta: { total: 0 } }));
    const client = { listDocuments } as unknown as ContextToolsClient;

    await executeContextTool(
      'agentteams_document_list',
      {
        q: undefined,
        tags: ['mcp'],
        untagged: false,
        favorite: false,
        page: 0,
        pageSize: 0,
      },
      client,
    );

    expect(listDocuments).toHaveBeenCalledWith({
      tags: ['mcp'],
      untagged: false,
      favorite: false,
      page: 0,
      pageSize: 0,
    });
  });

  it('rejects invalid list inputs before invoking the client', async () => {
    const listDocuments = jest.fn();
    const listPlans = jest.fn();
    const client = { listDocuments, listPlans } as unknown as ContextToolsClient;

    await expect(executeContextTool('agentteams_plan_list', { status: 'READY' }, client)).rejects.toThrow();
    await expect(executeContextTool('agentteams_plan_list', { dateFrom: '2026-02-30' }, client)).rejects.toThrow();
    await expect(executeContextTool('agentteams_document_list', { tags: [] }, client)).rejects.toThrow();
    await expect(executeContextTool('agentteams_document_list', { tags: [''] }, client)).rejects.toThrow();
    await expect(executeContextTool('agentteams_document_list', { untagged: 'false' }, client)).rejects.toThrow();
    await expect(executeContextTool('agentteams_document_list', { pageSize: 101 }, client)).rejects.toThrow();

    expect(listDocuments).not.toHaveBeenCalled();
    expect(listPlans).not.toHaveBeenCalled();
  });

  it('routes mutually exclusive comment parents and allows taskId with an optional planId', async () => {
    const listComments = jest.fn();
    const listFindingComments = jest.fn();
    const listTaskComments = jest.fn(async () => ({ data: [] }));
    const listDocumentComments = jest.fn();
    const client = {
      listComments,
      listFindingComments,
      listTaskComments,
      listDocumentComments,
    } as unknown as ContextToolsClient;

    await expect(executeContextTool('agentteams_comment_list', {}, client)).rejects.toThrow(/requires a parent scope/);
    // 최상위 union 이 지키던 계약이라 평탄화 후에는 오류에 충돌 키가 드러나야 원인을 알 수 있다.
    await expect(
      executeContextTool('agentteams_comment_list', { planId: 'plan-1', findingId: 'finding-1' }, client),
    ).rejects.toThrow(/more than one parent: planId, findingId/);
    // type 은 planId 단독일 때만 의미가 있다(예전 union 의 planId 분기).
    await expect(
      executeContextTool('agentteams_comment_list', { findingId: 'finding-1', type: 'RISK' }, client),
    ).rejects.toThrow(/only accepts type with planId/);

    await executeContextTool(
      'agentteams_comment_list',
      {
        taskId: 'agentteams_tsk_task-1',
        planId: 'agentteams_pln_plan-1',
        order: 'desc',
        page: 0,
      },
      client,
    );

    expect(listComments).not.toHaveBeenCalled();
    expect(listFindingComments).not.toHaveBeenCalled();
    expect(listDocumentComments).not.toHaveBeenCalled();
    expect(listTaskComments).toHaveBeenCalledWith('task-1', {
      planId: 'plan-1',
      order: 'desc',
      page: 0,
    });
  });

  // 문서 코멘트는 별도 라우트라 부모 분기가 없으면 MCP-first 에이전트가 답글은커녕 코멘트도 못 읽는다.
  it('routes documentId to the document comment list and rejects mixing it with other parents', async () => {
    const listComments = jest.fn();
    const listTaskComments = jest.fn();
    const listDocumentComments = jest.fn(async () => ({ data: [] }));
    const client = {
      listComments,
      listTaskComments,
      listDocumentComments,
    } as unknown as ContextToolsClient;

    await expect(
      executeContextTool('agentteams_comment_list', { documentId: 'document-1', planId: 'plan-1' }, client),
    ).rejects.toThrow(/more than one parent: planId, documentId/);

    await executeContextTool(
      'agentteams_comment_list',
      { documentId: 'agentteams_doc_document-1', order: 'asc', pageSize: 50 },
      client,
    );

    expect(listComments).not.toHaveBeenCalled();
    expect(listTaskComments).not.toHaveBeenCalled();
    expect(listDocumentComments).toHaveBeenCalledWith('document-1', {
      order: 'asc',
      pageSize: 50,
    });
  });

  // Kiro 의 Bedrock 백엔드는 최상위 union input schema 를 400 으로 거부하고 그 400 이 대화
  // 전체를 죽인다. 평탄화가 풀리면 그 클라이언트가 다시 브릭되므로 루트 모양을 고정한다.
  it('publishes every read tool with an object root, never a top-level union', () => {
    for (const spec of getContextToolSpecs()) {
      const schema = z.toJSONSchema(spec.inputSchema) as Record<string, unknown>;

      expect(schema).not.toHaveProperty('anyOf');
      expect(schema).not.toHaveProperty('oneOf');
      expect(schema.type).toBe('object');
    }
  });

  it('routes each single comment parent to its own client method after flattening', async () => {
    const listComments = jest.fn(async () => ({ data: [] }));
    const listFindingComments = jest.fn(async () => ({ data: [] }));
    const listTaskComments = jest.fn(async () => ({ data: [] }));
    const listDocumentComments = jest.fn(async () => ({ data: [] }));
    const client = {
      listComments,
      listFindingComments,
      listTaskComments,
      listDocumentComments,
    } as unknown as ContextToolsClient;

    await executeContextTool(
      'agentteams_comment_list',
      { planId: 'agentteams_pln_plan-1', type: 'RISK', order: 'asc' },
      client,
    );
    await executeContextTool('agentteams_comment_list', { findingId: 'agentteams_rvf_finding-1' }, client);
    await executeContextTool('agentteams_comment_list', { taskId: 'agentteams_tsk_task-1' }, client);
    await executeContextTool('agentteams_comment_list', { documentId: 'agentteams_doc_document-1' }, client);

    expect(listComments).toHaveBeenCalledWith('plan-1', { type: 'RISK', order: 'asc' });
    expect(listFindingComments).toHaveBeenCalledWith('finding-1', {});
    expect(listTaskComments).toHaveBeenCalledWith('task-1', {});
    expect(listDocumentComments).toHaveBeenCalledWith('document-1', {});
  });

  it('normalizes entity-bearing filters and finding ids but leaves raw comment ids unchanged', async () => {
    const listCodeReviews = jest.fn(async () => ({ data: [] }));
    const listCodeReviewFindings = jest.fn(async () => ({ data: [] }));
    const getCodeReviewFinding = jest.fn(async () => ({ data: {} }));
    const getComment = jest.fn(async () => ({ data: {} }));
    const client = {
      listCodeReviews,
      listCodeReviewFindings,
      getCodeReviewFinding,
      getComment,
    } as unknown as ContextToolsClient;

    await executeContextTool(
      'agentteams_codereview_list',
      {
        sourcePlanId: 'agentteams_pln_plan-1',
        sourceCompletionReportId: 'agentteams_rpt_report-1',
      },
      client,
    );
    await executeContextTool(
      'agentteams_codereview_finding_list',
      {
        codeReviewId: 'agentteams_rev_review-1',
        page: 2,
        pageSize: 20,
      },
      client,
    );
    await executeContextTool(
      'agentteams_codereview_finding_get',
      {
        id: 'agentteams_rvf_finding-1',
        codeReviewId: 'agentteams_rev_review-1',
      },
      client,
    );
    await executeContextTool('agentteams_comment_get', { id: 'agentteams_pln_raw-comment-id' }, client);

    expect(listCodeReviews).toHaveBeenCalledWith({
      sourcePlanId: 'plan-1',
      sourceCompletionReportId: 'report-1',
    });
    expect(listCodeReviewFindings).toHaveBeenCalledWith('review-1', { page: 2, pageSize: 20 });
    expect(getCodeReviewFinding).toHaveBeenCalledWith('finding-1', 'review-1');
    expect(getComment).toHaveBeenCalledWith('agentteams_pln_raw-comment-id');
  });
});

describe('document payload trimming', () => {
  // bodyTiptap은 서버가 body에서 매 응답 파생 생성하는 에디터 전용 미러다.
  // 에이전트는 마크다운 body만 소비하는데 실측에서 원본의 약 6배로 부풀어
  // 단건 조회 하나가 토큰 예산을 넘겼다. MCP 경로에서만 걷어낸다.
  const documentPayload = () => ({
    data: {
      id: 'doc-1',
      title: '문서',
      body: '# 본문',
      bodyTiptap: '{"type":"doc","content":[]}',
      visibility: 'PRIVATE',
      tags: ['mcp'],
      updatedAt: '2026-08-02T00:00:00.000Z',
      webUrl: 'https://agentteams.run/go?type=document&id=doc-1',
    },
  });

  it('omits the editor-only bodyTiptap mirror from document_get', async () => {
    const getDocument = jest.fn(async () => documentPayload());
    const client = { getDocument } as unknown as ContextToolsClient;

    const result = (await executeContextTool('agentteams_document_get', { id: 'agentteams_doc_doc-1' }, client)) as {
      data: Record<string, unknown>;
    };

    expect(result.data).not.toHaveProperty('bodyTiptap');
    expect(getDocument).toHaveBeenCalledWith('doc-1');
  });

  it('keeps the markdown body and every field a later write depends on', async () => {
    const getDocument = jest.fn(async () => documentPayload());
    const client = { getDocument } as unknown as ContextToolsClient;

    const result = (await executeContextTool('agentteams_document_get', { id: 'doc-1' }, client)) as {
      data: Record<string, unknown>;
    };

    // updatedAt이 빠지면 후속 수정의 expectedUpdatedAt 동시편집 가드가 조용히 무력화된다.
    expect(result.data).toMatchObject({
      id: 'doc-1',
      title: '문서',
      body: '# 본문',
      visibility: 'PRIVATE',
      tags: ['mcp'],
      updatedAt: '2026-08-02T00:00:00.000Z',
      webUrl: 'https://agentteams.run/go?type=document&id=doc-1',
    });
  });

  it('does not claim the payload is returned verbatim', () => {
    const spec = getContextToolSpecs().find((candidate) => candidate.name === 'agentteams_document_get');

    expect(spec?.description).not.toContain('nothing is summarized or omitted');
    expect(spec?.description).toContain('bodyTiptap');
  });

  it('leaves other entity get tools untouched', async () => {
    // 제외는 문서 스펙 안에서만 한다. 공용 팩토리를 고치면 plan/report/coaction까지 함께 바뀐다.
    const getPlan = jest.fn(async () => ({ data: { id: 'plan-1', bodyTiptap: 'kept' } }));
    const client = { getPlan } as unknown as ContextToolsClient;

    const result = (await executeContextTool('agentteams_plan_get', { id: 'plan-1' }, client)) as {
      data: Record<string, unknown>;
    };

    expect(result.data).toHaveProperty('bodyTiptap', 'kept');
  });
});
