import { omitDocumentEditorMirror, stripContextEntityIdPrefix } from '@agentteams/context-tools';
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
import type { McpToolContext } from './context.js';
import { GUIDE_RECORD_KINDS, describeMissingGuideHash, resolvePlatformGuide, type GuideRecordKind } from './guides.js';

/**
 * MCP **write** tools. CLI-only on purpose.
 *
 * These are deliberately *not* added to `@agentteams/context-tools`:
 * `desktop/src/main/localAgent/directRunner.ts` advertises every context-tool
 * definition to the model without filtering, so a write tool placed there would
 * be handed to Direct BYOK conversations — the exact `DESKTOP_LIMITED` boundary
 * that must not grant blanket project write access.
 *
 * The spec shape mirrors `ContextToolSpec`, but is declared locally so the shared
 * read package stays read-only. No MCP SDK import belongs here — `server.ts` is
 * the only adapter (see `test/mcp-boundary.test.ts`).
 */
export interface McpWriteToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  handler(args: Record<string, unknown>, context: McpToolContext): Promise<unknown>;
}

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

/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
const auth = (context: McpToolContext): Promise<Record<string, string>> =>
  context.resolveHeaders?.() ?? Promise.resolve(context.headers);

/** Drop keys the caller omitted so an absent optional never reaches the server as `undefined`. */
const definedFields = <T extends Record<string, unknown>>(fields: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

const guideGetSpec: McpWriteToolSpec = {
  name: 'agentteams_guide_get',
  title: 'Get AgentTeams Record Guide',
  description: [
    'Fetch the platform guide that governs how a record type must be written.',
    'Reads this project’s local copy when the session sits in it, and falls back to the server otherwise.',
    'Returns the full guide body plus the guideHash to pass to the matching write tool.',
    'Read this before any AgentTeams write tool call — the rules it states (visibility, tag policy, structure) are enforced server-side.',
    'If it reports that the local guide hash is unknown, run `agentteams convention download` in the project.',
  ].join(' '),
  inputSchema: z.strictObject({
    recordKind: z
      .enum(GUIDE_RECORD_KINDS)
      .describe('Record type whose guide you need. "document" and "comment" are write-enabled.'),
  }),
  handler: async (args, context) => {
    const guide = await resolvePlatformGuide(args.recordKind as GuideRecordKind, {
      projectRoot: context.projectRoot,
      apiUrl: context.apiUrl,
      headers: await auth(context),
    });
    const warning = describeMissingGuideHash(guide);
    return {
      recordKind: guide.recordKind,
      fileName: guide.fileName,
      source: guide.source,
      ...(guide.filePath ? { filePath: guide.filePath } : {}),
      guideHash: guide.guideHash,
      content: guide.content,
      ...(warning ? { warning } : {}),
    };
  },
};

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

/**
 * Exactly one target. The server would reject two anyway, but rejecting at the schema means the
 * model is told which shape is wrong instead of receiving a generic 400 after the call.
 */
const commentTargetSchema = z.union([
  z.strictObject({
    planId: z.string().min(1).describe('Plan id (bare uuid or agentteams_pln_-prefixed).'),
    type: z
      .enum(['RISK', 'MODIFICATION', 'GENERAL'])
      .describe('Plan comments carry a type. RISK stops a runner executing the plan — do not use it lightly.'),
    affectedFiles: z
      .array(z.string().min(1))
      .optional()
      .describe('Repository paths this comment is about. Plan comments only.'),
    content: z.string().min(1).describe('Comment body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  z.strictObject({
    taskId: z.string().min(1).describe('Plan task id (bare uuid or agentteams_tsk_-prefixed).'),
    content: z.string().min(1).describe('Comment body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  z.strictObject({
    documentId: z.string().min(1).describe('Document id (bare uuid or agentteams_doc_-prefixed).'),
    content: z.string().min(1).describe('Comment body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
  z.strictObject({
    findingId: z.string().min(1).describe('Code-review finding id (bare uuid or agentteams_rvf_-prefixed).'),
    content: z.string().min(1).describe('Comment body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
  }),
]);

const commentCreateSpec: McpWriteToolSpec = {
  name: 'agentteams_comment_create',
  title: 'Create AgentTeams Comment',
  description: [
    'Add a root comment to a plan, a plan task, a document, or a code-review finding.',
    'Pass exactly one of planId, taskId, documentId, findingId — a comment has one parent by construction.',
    'Only a plan comment carries type and affectedFiles; the other targets take content alone.',
    COMMENT_GUIDE_FIRST,
    'Comments on a DONE or CANCELLED plan (and on its tasks) are rejected.',
    PROJECT_SCOPE,
    'Returns the created comment id and the webUrl of the parent screen a human can open.',
  ].join(' '),
  inputSchema: commentTargetSchema,
  handler: async (args, context) => {
    const headers = await auth(context);
    const contract = definedFields({ guideHash: args.guideHash, idempotencyKey: args.idempotencyKey });

    if ('planId' in args) {
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
    if ('taskId' in args) {
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
    if ('findingId' in args) {
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
    guideGetSpec,
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
