import {
  defineToolDiscoveryMetadata,
  omitDocumentEditorMirror,
  stripContextEntityIdPrefix,
} from '@agentteams/context-tools';
import { z } from 'zod';
import {
  createComment,
  createFindingComment,
  createReply,
  createTaskComment,
  deleteComment,
  deleteReply,
  updateComment,
  updateReply,
} from '../api/comment.js';
import { createDocumentComment, createDocument, deleteDocument, updateDocument } from '../api/document.js';
import { resolveToolHeaders, type McpLocalToolSpec } from './localTools.js';

/**
 * MCP **write** tools. CLI-only on purpose.
 *
 * These are deliberately *not* added to `@agentteams/context-tools`:
 * `desktop/src/main/localAgent/directRunner.ts` advertises every context-tool
 * definition to the model without filtering, so a write tool placed there would
 * be handed to Direct BYOK conversations — the exact `DESKTOP_LIMITED` boundary
 * that must not grant blanket project write access.
 *
 * The spec shape is the CLI-local one declared in `localTools.ts`, so the shared
 * read package stays read-only. No MCP SDK import belongs here — `server.ts` is
 * the only adapter (see `test/mcp-boundary.test.ts`).
 */
export type McpWriteToolSpec = McpLocalToolSpec;

const GUIDE_FIRST = 'Call agentteams_guide_get("document") first and follow that guide.';
const COMMENT_GUIDE_FIRST = 'Call agentteams_guide_get("comment") first and follow that guide.';
const TAG_POLICY =
  'You cannot set confirmed tags. Anything you pass in suggestedTags is a suggestion for a human to confirm.';
const PROJECT_SCOPE =
  'Scoped to the single project this MCP server is bound to. There is no projectId argument — a different project cannot be reached from here.';

const guideHashField = z
  .string()
  .min(1)
  .optional()
  .describe('guideHash from agentteams_guide_get. If it is stale the server rejects the write with GUIDE_OUTDATED.');

const idempotencyKeyField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Retry-safe key. Repeating the same call with the same key replays the first result instead of redoing it.',
  );

const expectedUpdatedAtField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "The document's updatedAt as you last read it. The write is rejected if someone else changed the document since.",
  );

const suggestedTagsField = z
  .array(z.string().min(1))
  .optional()
  .describe('Suggested tags (not confirmed). Reuse existing project tags where they fit.');

const visibilityField = z
  .enum(['PRIVATE', 'PROJECT'])
  .optional()
  .describe('PRIVATE (default) is author-only; PROJECT is visible to every project member.');

const documentWriteDiscovery = defineToolDiscoveryMetadata({
  domain: 'documents',
  profiles: ['full', 'documents'],
});
const commentWriteDiscovery = defineToolDiscoveryMetadata({
  domain: 'comments',
  profiles: ['full', 'comments'],
});

/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
const auth = resolveToolHeaders;

/** Drop keys the caller omitted so an absent optional never reaches the server as `undefined`. */
const definedFields = <T extends Record<string, unknown>>(fields: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

const documentCreateSpec: McpWriteToolSpec = {
  name: 'agentteams_document_create',
  title: 'Create AgentTeams Document',
  description: [
    'Create a document in this project’s document library.',
    GUIDE_FIRST,
    TAG_POLICY,
    PROJECT_SCOPE,
    'Returns the created document id and webUrl.',
  ].join(' '),
  discovery: documentWriteDiscovery,
  inputSchema: z.strictObject({
    title: z.string().min(1).max(255).describe('Document title.'),
    body: z.string().min(1).describe('Document body in Markdown.'),
    suggestedTags: suggestedTagsField,
    visibility: visibilityField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    // 쓰기 응답도 문서 상세와 같은 형태라 에디터 전용 bodyTiptap이 그대로 실린다.
    // 조회와 같은 규칙을 공유해야 두 표면 중 한쪽만 부풀어 오르는 일이 없다.
    return omitDocumentEditorMirror(
      await createDocument(
        context.apiUrl,
        context.projectId,
        await auth(context),
        definedFields({
          title: args.title,
          body: args.body,
          suggestedTags: args.suggestedTags,
          visibility: args.visibility,
          guideHash: args.guideHash,
          idempotencyKey: args.idempotencyKey,
        }),
      ),
    );
  },
};

const documentUpdateSpec: McpWriteToolSpec = {
  name: 'agentteams_document_update',
  title: 'Update AgentTeams Document',
  description: [
    'Update an existing document in this project. Only the fields you pass are changed.',
    GUIDE_FIRST,
    TAG_POLICY,
    'Pass expectedUpdatedAt (from agentteams_document_get) so a concurrent edit is rejected rather than silently overwritten.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: documentWriteDiscovery,
  inputSchema: z.strictObject({
    id: z.string().min(1).describe('Document id (bare uuid or agentteams_doc_-prefixed).'),
    title: z.string().min(1).max(255).optional().describe('New title.'),
    body: z.string().min(1).optional().describe('New body in Markdown. Replaces the whole body.'),
    suggestedTags: suggestedTagsField,
    visibility: visibilityField,
    expectedUpdatedAt: expectedUpdatedAtField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    return omitDocumentEditorMirror(
      await updateDocument(
        context.apiUrl,
        context.projectId,
        await auth(context),
        stripContextEntityIdPrefix(args.id as string),
        definedFields({
          title: args.title,
          body: args.body,
          suggestedTags: args.suggestedTags,
          visibility: args.visibility,
          expectedUpdatedAt: args.expectedUpdatedAt,
          guideHash: args.guideHash,
          idempotencyKey: args.idempotencyKey,
        }),
      ),
    );
  },
};

const documentDeleteSpec: McpWriteToolSpec = {
  name: 'agentteams_document_delete',
  title: 'Delete AgentTeams Document',
  description: [
    'Delete a document from this project. This is destructive — the document disappears from the library for everyone.',
    GUIDE_FIRST,
    'Without expectedUpdatedAt this is an unconditional delete: it removes the document even if someone edited it after you last read it.',
    'Pass expectedUpdatedAt (from agentteams_document_get) unless you intend that.',
    'Confirm with the user before deleting anything you did not just create.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: documentWriteDiscovery,
  inputSchema: z.strictObject({
    id: z.string().min(1).describe('Document id (bare uuid or agentteams_doc_-prefixed).'),
    expectedUpdatedAt: expectedUpdatedAtField,
    // 되돌리기 가장 어려운 작업에서만 최신성 게이트가 빠지면 표면이 비대칭해진다.
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    const documentId = stripContextEntityIdPrefix(args.id as string);
    await deleteDocument(context.apiUrl, context.projectId, await auth(context), documentId, {
      ...(args.expectedUpdatedAt ? { expectedUpdatedAt: args.expectedUpdatedAt as string } : {}),
      ...(args.guideHash ? { guideHash: args.guideHash as string } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey as string } : {}),
    });
    return { deleted: true, id: documentId };
  },
};

const commentIdField = z.string().min(1).describe('Root comment id (raw id — comment ids carry no prefix).');
const replyIdField = z.string().min(1).describe('Reply id (raw id). Not interchangeable with a root comment id.');

const commentExpectedUpdatedAtField = z
  .string()
  .min(1)
  .optional()
  .describe("The comment's updatedAt as you last read it. The write is rejected if someone else changed it since.");

const COMMENT_PARENT_KEYS = ['planId', 'taskId', 'documentId', 'findingId'] as const;
type CommentParentKey = (typeof COMMENT_PARENT_KEYS)[number];

// comment_list만 taskId + planId를 부모 제한 조합으로 허용한다. 생성은 부모를 하나만
// 받아야 하므로 같은 조합도 거부하며, 모델이 두 계약을 혼동하지 않도록 설명에도 명시한다.
const EXACTLY_ONE_PARENT =
  'Pass exactly one of planId, taskId, documentId, findingId — a comment has one parent by construction.';
const CREATE_PARENT_PAIRING_RULE = 'Do not pair taskId with planId when creating a comment.';

/**
 * Exactly one target, enforced at runtime rather than by the schema.
 *
 * This used to be a top-level `z.union`, which said the same thing in JSON Schema. But some model
 * backends (Kiro's Bedrock, verified 2.16.2) answer 400 to a tool whose `input_schema` root is a
 * union, and that 400 fails the whole request — one such tool makes every conversation in that
 * client unusable. So the root is a single object and the constraint the union used to carry lives
 * in {@link resolveCommentParent}: the model still learns which shape is wrong before the call
 * reaches the server.
 */
const commentTargetSchema = z.strictObject({
  planId: z
    .string()
    .min(1)
    .optional()
    .describe(`Plan id (bare uuid or agentteams_pln_-prefixed). ${EXACTLY_ONE_PARENT}`),
  taskId: z
    .string()
    .min(1)
    .optional()
    .describe(`Plan task id (bare uuid or agentteams_tsk_-prefixed). ${EXACTLY_ONE_PARENT}`),
  documentId: z
    .string()
    .min(1)
    .optional()
    .describe(`Document id (bare uuid or agentteams_doc_-prefixed). ${EXACTLY_ONE_PARENT}`),
  findingId: z
    .string()
    .min(1)
    .optional()
    .describe(`Code-review finding id (bare uuid or agentteams_rvf_-prefixed). ${EXACTLY_ONE_PARENT}`),
  type: z
    .enum(['RISK', 'MODIFICATION', 'GENERAL'])
    .optional()
    .describe(
      'Plan comments carry a type, and it is required with planId — rejected with any other parent. RISK stops a runner executing the plan — do not use it lightly.',
    ),
  affectedFiles: z
    .array(z.string().min(1))
    .optional()
    .describe('Repository paths this comment is about. Plan comments only — rejected with any other parent.'),
  content: z.string().min(1).describe('Comment body in Markdown.'),
  guideHash: guideHashField,
  idempotencyKey: idempotencyKeyField,
});

/** Which parent this call targets, or a tool error naming exactly what is wrong with the shape. */
function resolveCommentParent(args: Record<string, unknown>): CommentParentKey {
  const present = COMMENT_PARENT_KEYS.filter((key) => args[key] !== undefined);
  if (present.length === 0) {
    throw new Error(`agentteams_comment_create needs a parent. ${EXACTLY_ONE_PARENT}`);
  }
  if (present.length > 1) {
    throw new Error(
      `agentteams_comment_create received more than one parent: ${present.join(', ')}. ${EXACTLY_ONE_PARENT}`,
    );
  }

  const [parent] = present;
  if (parent === 'planId') {
    if (args.type === undefined) {
      throw new Error('agentteams_comment_create requires type (RISK | MODIFICATION | GENERAL) for a plan comment.');
    }
    return parent;
  }
  // PLAN 전용 필드는 조용히 버리지 않는다 — 예전 union 도 거부였고, 무시하면 모델은 값이
  // 실렸다고 믿은 채 다른 부모에 코멘트를 단다.
  const planOnly = (['type', 'affectedFiles'] as const).filter((key) => args[key] !== undefined);
  if (planOnly.length > 0) {
    throw new Error(
      `agentteams_comment_create only accepts ${planOnly.join(', ')} with planId, but the parent is ${parent}.`,
    );
  }
  return parent;
}

const commentCreateSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_create',
  title: 'Create AgentTeams Comment',
  description: [
    'Add a root comment to a plan, a plan task, a document, or a code-review finding.',
    EXACTLY_ONE_PARENT,
    CREATE_PARENT_PAIRING_RULE,
    'Only a plan comment carries type (required there) and affectedFiles; passing either with another parent is rejected, and the other targets take content alone.',
    COMMENT_GUIDE_FIRST,
    'Comments on a DONE or CANCELLED plan (and on its tasks) are rejected.',
    PROJECT_SCOPE,
    'Returns the created comment id and the webUrl of the parent screen a human can open.',
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: commentTargetSchema,
  handler: async (args, context) => {
    const parent = resolveCommentParent(args);
    const headers = await auth(context);
    // 도구 축은 모델이 고르는 값이 아니라 세션의 속성이라 inputSchema에 노출하지 않는다.
    // 데몬 밖 세션에는 값이 없고, 그때는 키 자체를 보내지 않아 현재 동작이 그대로 유지된다.
    const contract = definedFields({
      guideHash: args.guideHash,
      idempotencyKey: args.idempotencyKey,
      agentConfigId: context.agentConfigId,
    });

    if (parent === 'planId') {
      return createComment(
        context.apiUrl,
        context.projectId,
        headers,
        stripContextEntityIdPrefix(args.planId as string),
        {
          type: args.type as string,
          content: args.content as string,
          ...(args.affectedFiles ? { affectedFiles: args.affectedFiles as string[] } : {}),
          ...contract,
        },
      );
    }
    if (parent === 'taskId') {
      return createTaskComment(
        context.apiUrl,
        context.projectId,
        headers,
        stripContextEntityIdPrefix(args.taskId as string),
        {
          content: args.content as string,
          ...contract,
        },
      );
    }
    if (parent === 'findingId') {
      return createFindingComment(
        context.apiUrl,
        context.projectId,
        headers,
        stripContextEntityIdPrefix(args.findingId as string),
        { content: args.content as string, ...contract },
      );
    }
    return createDocumentComment(
      context.apiUrl,
      context.projectId,
      headers,
      stripContextEntityIdPrefix(args.documentId as string),
      { content: args.content as string, ...contract },
    );
  },
};

const commentUpdateSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_update',
  title: 'Update AgentTeams Comment',
  description: [
    'Edit a root comment. Only the author may edit; this refuses a reply id (use agentteams_comment_reply_update).',
    COMMENT_GUIDE_FIRST,
    'Pass expectedUpdatedAt (from agentteams_comment_get) so a concurrent edit is rejected rather than silently overwritten.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: z.strictObject({
    commentId: commentIdField,
    content: z.string().min(1).describe('New body in Markdown. Replaces the whole comment.'),
    type: z
      .enum(['RISK', 'MODIFICATION', 'GENERAL'])
      .optional()
      .describe('Plan comments only. Leave unset for task, document, and finding comments.'),
    affectedFiles: z.array(z.string().min(1)).optional().describe('Plan comments only.'),
    expectedUpdatedAt: commentExpectedUpdatedAtField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    return updateComment(
      context.apiUrl,
      context.projectId,
      await auth(context),
      stripContextEntityIdPrefix(args.commentId as string),
      definedFields({
        content: args.content,
        type: args.type,
        affectedFiles: args.affectedFiles,
        expectedUpdatedAt: args.expectedUpdatedAt,
        guideHash: args.guideHash,
        idempotencyKey: args.idempotencyKey,
      }) as { content: string },
    );
  },
};

const commentDeleteSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_delete',
  title: 'Delete AgentTeams Comment',
  description: [
    'Delete a root comment. This is destructive and takes the whole thread with it — every reply under it disappears too.',
    COMMENT_GUIDE_FIRST,
    'Without expectedUpdatedAt this is an unconditional delete: it removes the comment even if someone edited it after you last read it.',
    'Confirm with the user before deleting anything you did not just create.',
    'This refuses a reply id — use agentteams_comment_reply_delete for a reply.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: z.strictObject({
    commentId: commentIdField,
    expectedUpdatedAt: commentExpectedUpdatedAtField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    const commentId = stripContextEntityIdPrefix(args.commentId as string);
    await deleteComment(
      context.apiUrl,
      context.projectId,
      await auth(context),
      commentId,
      definedFields({
        expectedUpdatedAt: args.expectedUpdatedAt,
        guideHash: args.guideHash,
        idempotencyKey: args.idempotencyKey,
      }),
    );
    return { deleted: true, id: commentId };
  },
};

const commentReplyCreateSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_reply_create',
  title: 'Reply to an AgentTeams Comment',
  description: [
    'Add a reply to a root comment. The reply inherits the root comment’s target; you do not choose one.',
    'Replies are one level deep — a reply cannot be the parent of another reply, and passing a reply id here is rejected.',
    COMMENT_GUIDE_FIRST,
    PROJECT_SCOPE,
    'Returns the created reply id and the webUrl of the parent screen a human can open.',
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: z.strictObject({
    commentId: commentIdField,
    content: z.string().min(1).describe('Reply body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    return createReply(
      context.apiUrl,
      context.projectId,
      await auth(context),
      stripContextEntityIdPrefix(args.commentId as string),
      definedFields({
        content: args.content,
        guideHash: args.guideHash,
        idempotencyKey: args.idempotencyKey,
        agentConfigId: context.agentConfigId,
      }) as { content: string },
    );
  },
};

const commentReplyUpdateSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_reply_update',
  title: 'Update AgentTeams Comment Reply',
  description: [
    'Edit a reply. Only the author may edit; this refuses a root comment id (use agentteams_comment_update).',
    COMMENT_GUIDE_FIRST,
    'Pass expectedUpdatedAt (from agentteams_comment_reply_get) so a concurrent edit is rejected rather than silently overwritten.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: z.strictObject({
    replyId: replyIdField,
    content: z.string().min(1).describe('New body in Markdown. Replaces the whole reply.'),
    expectedUpdatedAt: commentExpectedUpdatedAtField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    return updateReply(
      context.apiUrl,
      context.projectId,
      await auth(context),
      stripContextEntityIdPrefix(args.replyId as string),
      definedFields({
        content: args.content,
        expectedUpdatedAt: args.expectedUpdatedAt,
        guideHash: args.guideHash,
        idempotencyKey: args.idempotencyKey,
      }) as { content: string },
    );
  },
};

const commentReplyDeleteSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_reply_delete',
  title: 'Delete AgentTeams Comment Reply',
  description: [
    'Delete a reply. This is destructive.',
    COMMENT_GUIDE_FIRST,
    'Without expectedUpdatedAt this is an unconditional delete: it removes the reply even if someone edited it after you last read it.',
    'Confirm with the user before deleting anything you did not just create.',
    'This refuses a root comment id — use agentteams_comment_delete for a root comment.',
    PROJECT_SCOPE,
  ].join(' '),
  discovery: commentWriteDiscovery,
  inputSchema: z.strictObject({
    replyId: replyIdField,
    expectedUpdatedAt: commentExpectedUpdatedAtField,
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  handler: async (args, context) => {
    const replyId = stripContextEntityIdPrefix(args.replyId as string);
    await deleteReply(
      context.apiUrl,
      context.projectId,
      await auth(context),
      replyId,
      definedFields({
        expectedUpdatedAt: args.expectedUpdatedAt,
        guideHash: args.guideHash,
        idempotencyKey: args.idempotencyKey,
      }),
    );
    return { deleted: true, id: replyId };
  },
};

/** Every write tool the CLI MCP server exposes, in registration order. */
export function getWriteToolSpecs(): McpWriteToolSpec[] {
  return [
    documentCreateSpec,
    documentUpdateSpec,
    documentDeleteSpec,
    commentCreateSpec,
    commentUpdateSpec,
    commentDeleteSpec,
    commentReplyCreateSpec,
    commentReplyUpdateSpec,
    commentReplyDeleteSpec,
  ];
}
