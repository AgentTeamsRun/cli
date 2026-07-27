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

    expect(listSpecs).toHaveLength(8);
    for (const spec of listSpecs) {
      expect(spec.description).toContain('one page');
      expect(spec.description).toContain('meta.total');
      expect(spec.description).toContain('meta.totalPages');
      expect(spec.description).toContain('metadata-only');
      expect(spec.description).toContain('agentteams_search');
    }

    expect(specs.find(({ name }) => name === 'agentteams_search')?.description).toContain('topic and relevance');
    expect(specs.find(({ name }) => name === 'agentteams_search')?.description).toContain('exact filtered count');
  });

  it('describes one shared project binding for every search, list, and get tool', () => {
    const readSpecs = getContextToolSpecs().filter(
      ({ name }) => name === 'agentteams_search' || name.endsWith('_list') || name.endsWith('_get'),
    );

    expect(readSpecs).toHaveLength(18);
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

    await expect(executeContextTool('agentteams_comment_list', {}, client)).rejects.toThrow();
    await expect(
      executeContextTool('agentteams_comment_list', { planId: 'plan-1', findingId: 'finding-1' }, client),
    ).rejects.toThrow();

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
    ).rejects.toThrow();

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

  it('normalizes entity-bearing filters and finding ids but leaves raw comment ids unchanged', async () => {
    const listCodeReviews = jest.fn(async () => ({ data: [] }));
    const getCodeReviewFinding = jest.fn(async () => ({ data: {} }));
    const getComment = jest.fn(async () => ({ data: {} }));
    const client = {
      listCodeReviews,
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
    expect(getCodeReviewFinding).toHaveBeenCalledWith('finding-1', 'review-1');
    expect(getComment).toHaveBeenCalledWith('agentteams_pln_raw-comment-id');
  });
});
