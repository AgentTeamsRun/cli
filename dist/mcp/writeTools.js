import { defineToolDiscoveryMetadata, stripContextEntityIdPrefix } from '@agentteams/context-tools';
import { z } from 'zod';
import { createComment, createFindingComment, createReply, createTaskComment, deleteComment, deleteReply, updateComment, updateReply, } from '../api/comment.js';
import { createDocumentComment, createDocument, deleteDocument, updateDocument } from '../api/document.js';
import { createCoAction, deleteCoAction, updateCoAction } from '../api/coaction.js';
import { createPostMortem, updatePostMortem } from '../api/postmortem.js';
import { linkPlanDocument, unlinkPlanDocument } from '../api/plan.js';
import { cancelCodeReview, createCodeReview, dismissCodeReviewFinding, resolveCodeReviewFinding, undismissCodeReviewFinding, updateCodeReview, } from '../api/codeReview.js';
import { RUNNER_TYPE_VALUES } from '../utils/runnerTypes.js';
import { resolveToolHeaders } from './localTools.js';
const guideOncePerSession = (kind) => `Read agentteams_guide_get("${kind}") once per session and follow it; reuse its guideHash until GUIDE_OUTDATED.`;
const GUIDE_FIRST = guideOncePerSession('document');
const COMMENT_GUIDE_FIRST = guideOncePerSession('comment');
const CO_ACTION_GUIDE_FIRST = guideOncePerSession('co-action');
const POST_MORTEM_GUIDE_FIRST = guideOncePerSession('post-mortem');
const CODE_REVIEW_GUIDE_FIRST = guideOncePerSession('code-review');
const TAG_POLICY = 'You cannot set confirmed tags. Anything you pass in suggestedTags is a suggestion for a human to confirm.';
const PROJECT_SCOPE = 'Scoped to the single project this MCP server is bound to. There is no projectId argument — a different project cannot be reached from here.';
const FULL_RECORD_VIA_GET = 'Use the matching *_get tool when you need fields beyond this summary.';
const guideHashField = z.string().min(1).optional().describe('guideHash from agentteams_guide_get.');
const idempotencyKeyField = z
    .string()
    .min(1)
    .optional()
    .describe('Retry-safe key. Repeating the same call with the same key replays the first result instead of redoing it.');
const expectedUpdatedAtField = z
    .string()
    .min(1)
    .optional()
    .describe("The document's updatedAt as you last read it. The write is rejected if someone else changed the document since.");
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
const coActionWriteDiscovery = defineToolDiscoveryMetadata({
    domain: 'coActions',
    profiles: ['full'],
});
const postMortemWriteDiscovery = defineToolDiscoveryMetadata({
    domain: 'postMortems',
    profiles: ['full'],
});
const codeReviewWriteDiscovery = defineToolDiscoveryMetadata({
    domain: 'codeReviews',
    profiles: ['full'],
});
const planDocumentWriteDiscovery = defineToolDiscoveryMetadata({
    domain: 'plans',
    profiles: ['full'],
});
/** Credentials can expire mid-session, so headers are resolved per call, never captured. */
const auth = resolveToolHeaders;
/** Drop keys the caller omitted so an absent optional never reaches the server as `undefined`. */
const definedFields = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
const requireOneOf = (toolName, args, fieldNames) => {
    if (!fieldNames.some((fieldName) => args[fieldName] !== undefined)) {
        throw new Error(`${toolName} requires at least one of: ${fieldNames.join(', ')}.`);
    }
};
/**
 * 쓰기 응답 투영: envelope의 `data`만 지정 필드로 줄이고 나머지 최상위 키는 통과시킨다.
 *
 * 쓰기 핸들러는 API 응답을 그대로 돌려줘서 finding 1건 변경에 리뷰 전체가 실리는 식으로
 * 에이전트 컨텍스트를 빠르게 채운다. `data`에 없는 필드는 생략하므로 서버 응답 형태가
 * 바뀌어도 깨지지 않는다. `data` 외 최상위 키(`webUrl`, `planWebUrl` 등 부모 화면 링크)는
 * 그대로 둔다 — 그 키가 없으면 모델이 결과 화면을 열 수 없다.
 */
const projectResponseFields = (data, fields) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return data;
    const source = data;
    const picked = {};
    for (const field of fields) {
        if (source[field] !== undefined) {
            picked[field] = source[field];
        }
    }
    return picked;
};
const projectWriteResponse = (payload, fields) => {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        return payload;
    const record = payload;
    if (record.data === undefined)
        return payload;
    return { ...record, data: projectResponseFields(record.data, fields) };
};
// 문서 본문(body)은 투영에서 제외한다. 전체가 필요하면 agentteams_document_get으로 조회한다.
const DOCUMENT_SUMMARY_FIELDS = ['id', 'title', 'visibility', 'tags', 'suggestedTags', 'updatedAt', 'webUrl'];
// 코멘트·답글 본문(content)은 투영에서 제외한다. 부모 식별자는 targetType·targetId,
// 플랜 코멘트의 planId 별칭, 문서 코멘트의 documentId, 답글의 parentId(원댓글 id) 중
// 응답에 있는 것만 남는다.
const COMMENT_SUMMARY_FIELDS = [
    'id',
    'targetType',
    'targetId',
    'parentId',
    'planId',
    'documentId',
    'updatedAt',
];
// 코액션·포스트모템·코드리뷰 create/update는 식별·상태·동시성·링크만 남긴다.
const REVIEW_SUMMARY_FIELDS = ['id', 'status', 'updatedAt', 'webUrl'];
const FINDING_SUMMARY_FIELDS = ['id', 'status', 'updatedAt'];
/**
 * finding 상태 전이 응답 투영: 리뷰는 식별·상태·동시성·링크만 남기고, findings 배열은
 * 버리는 대신 전이된 finding 하나만 `finding` 키로 붙인다. 서버는 전이·재생 모두
 * 리뷰 전체를 `{ data: review }`로 돌려주므로 둘 다 같은 투영을 거친다.
 */
const projectFindingStatusResponse = (payload, findingId) => {
    const projected = projectWriteResponse(payload, REVIEW_SUMMARY_FIELDS);
    if (projected === null || typeof projected !== 'object' || Array.isArray(projected))
        return projected;
    const record = payload;
    const data = record.data;
    const findings = data && Array.isArray(data.findings) ? data.findings : [];
    const bareFindingId = stripContextEntityIdPrefix(findingId);
    const changed = findings.find((finding) => finding !== null &&
        typeof finding === 'object' &&
        !Array.isArray(finding) &&
        (finding.id === bareFindingId ||
            finding.id === findingId));
    if (changed === undefined)
        return projected;
    return {
        ...projected,
        data: {
            ...projected.data,
            finding: projectResponseFields(changed, FINDING_SUMMARY_FIELDS),
        },
    };
};
const CODE_REVIEW_TARGET_TYPE_VALUES = [
    'BRANCH_DIFF',
    'GITHUB_PR',
    'GITLAB_MR',
    'BITBUCKET_PR',
    'LOCAL_DIFF',
    'UPLOADED_DIFF',
    'COMMIT_RANGE',
];
const CODE_REVIEW_FINDING_IMPACT_AREA_VALUES = [
    'UI',
    'BUSINESS_RULE',
    'CONTRACT',
    'DATA',
    'SECURITY',
    'OPS',
    'DOCS',
    'TEST',
    'OTHER',
];
const CODE_REVIEW_UPDATE_METADATA_FIELDS = [
    'title',
    'targetType',
    'targetRef',
    'sourceCommitStart',
    'sourceCommitEnd',
    'sourceBranchName',
    'baseBranchName',
    'diffSummary',
    'testSummary',
    'reviewerContext',
    'recommendationReason',
    'runnerType',
    'model',
];
const validateInitialCodeReviewFindings = (args) => {
    if (args.findings !== undefined && (args.runnerType === undefined || args.model === undefined)) {
        throw new Error('agentteams_codereview_create requires runnerType and model when findings are provided.');
    }
};
const validateInitialCodeReviewResultSummary = (args) => {
    if (args.resultSummary !== undefined && args.findings === undefined) {
        throw new Error('agentteams_codereview_create requires findings when resultSummary is provided.');
    }
};
const validateCodeReviewCancellation = (args) => {
    if (args.status !== 'CANCELLED')
        return;
    const incompatibleFields = [...CODE_REVIEW_UPDATE_METADATA_FIELDS, 'expectedUpdatedAt'].filter((fieldName) => args[fieldName] !== undefined);
    if (incompatibleFields.length > 0) {
        throw new Error(`agentteams_codereview_update with status CANCELLED cannot include: ${incompatibleFields.join(', ')}.`);
    }
};
const documentCreateSpec = {
    name: 'agentteams_document_create',
    title: 'Create AgentTeams Document',
    description: [
        'Create a document in this project’s document library.',
        GUIDE_FIRST,
        TAG_POLICY,
        PROJECT_SCOPE,
        'Returns the created document summary: id, title, visibility, tags, suggestedTags, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
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
        // 쓰기 응답은 식별·표시·동시성·링크만 남긴다. 본문이 필요하면 agentteams_document_get으로 조회한다.
        return projectWriteResponse(await createDocument(context.apiUrl, context.projectId, await auth(context), definedFields({
            title: args.title,
            body: args.body,
            suggestedTags: args.suggestedTags,
            visibility: args.visibility,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), DOCUMENT_SUMMARY_FIELDS);
    },
};
const documentUpdateSpec = {
    name: 'agentteams_document_update',
    title: 'Update AgentTeams Document',
    description: [
        'Update an existing document in this project. Only the fields you pass are changed.',
        GUIDE_FIRST,
        TAG_POLICY,
        'Pass expectedUpdatedAt (from agentteams_document_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated document summary: id, title, visibility, tags, suggestedTags, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
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
        return projectWriteResponse(await updateDocument(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.id), definedFields({
            title: args.title,
            body: args.body,
            suggestedTags: args.suggestedTags,
            visibility: args.visibility,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), DOCUMENT_SUMMARY_FIELDS);
    },
};
const documentDeleteSpec = {
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
        const documentId = stripContextEntityIdPrefix(args.id);
        await deleteDocument(context.apiUrl, context.projectId, await auth(context), documentId, {
            ...(args.expectedUpdatedAt ? { expectedUpdatedAt: args.expectedUpdatedAt } : {}),
            ...(args.guideHash ? { guideHash: args.guideHash } : {}),
            ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
        });
        return { deleted: true, id: documentId };
    },
};
const planIdField = z.string().min(1).describe('Plan id (bare uuid or agentteams_pln_-prefixed).');
const linkedDocumentIdField = z.string().min(1).describe('Document id (bare uuid or agentteams_doc_-prefixed).');
// 조인 행 하나를 만들고 지우는 연산이라 가이드가 규율할 저작 행위가 없고, 플랜 라우트는
// agentWriteContract 헬퍼를 쓰지 않아 guideHash·idempotencyKey를 보내도 무시된다. 그래서 둘 다 노출하지 않는다.
const planDocumentLinkSpec = {
    name: 'agentteams_plan_document_link',
    title: 'Link AgentTeams Document to Plan',
    description: [
        'Link a document from this project’s document library to a plan, so the plan shows it under its linked items.',
        'On creation, returns { data: linkRecord } (id, planId, documentId, title, visibility, note).',
        'If already linked (409), returns only { alreadyLinked: true, planId, documentId }, with no data or link record; the existing note is unchanged.',
        PROJECT_SCOPE,
    ].join(' '),
    discovery: planDocumentWriteDiscovery,
    inputSchema: z.strictObject({
        planId: planIdField,
        documentId: linkedDocumentIdField,
        note: z.string().min(1).optional().describe('Why the document is linked, shown next to the link.'),
    }),
    handler: async (args, context) => {
        const planId = stripContextEntityIdPrefix(args.planId);
        const documentId = stripContextEntityIdPrefix(args.documentId);
        try {
            return await linkPlanDocument(context.apiUrl, context.projectId, await auth(context), planId, definedFields({ documentId, note: args.note }));
        }
        catch (err) {
            // CLI plan link-document와 같이 이미 연결된 상태(409)는 실패가 아니라 완료로 돌려준다.
            if (err?.response?.status === 409) {
                return { alreadyLinked: true, planId, documentId };
            }
            throw err;
        }
    },
};
const planDocumentUnlinkSpec = {
    name: 'agentteams_plan_document_unlink',
    title: 'Unlink AgentTeams Document from Plan',
    description: [
        'Remove the link between a plan and a document. The document itself is not deleted.',
        'This cannot be undone — any note on the link is lost.',
        'Confirm with the user before removing a link you did not just create.',
        PROJECT_SCOPE,
    ].join(' '),
    discovery: planDocumentWriteDiscovery,
    inputSchema: z.strictObject({
        planId: planIdField,
        documentId: linkedDocumentIdField,
    }),
    handler: async (args, context) => {
        const planId = stripContextEntityIdPrefix(args.planId);
        const documentId = stripContextEntityIdPrefix(args.documentId);
        await unlinkPlanDocument(context.apiUrl, context.projectId, await auth(context), planId, documentId);
        return { unlinked: true, planId, documentId };
    },
};
const commentIdField = z.string().min(1).describe('Root comment id (raw id — comment ids carry no prefix).');
const replyIdField = z.string().min(1).describe('Reply id (raw id). Not interchangeable with a root comment id.');
const commentExpectedUpdatedAtField = z
    .string()
    .min(1)
    .optional()
    .describe("The comment's updatedAt as you last read it. The write is rejected if someone else changed it since.");
const expectedUpdatedAtFieldFor = (entity) => z
    .string()
    .min(1)
    .optional()
    .describe(`The ${entity}'s updatedAt as you last read it. The write is rejected if someone else changed it since.`);
const COMMENT_PARENT_KEYS = ['planId', 'taskId', 'documentId', 'findingId'];
// comment_list만 taskId + planId를 부모 제한 조합으로 허용한다. 생성은 부모를 하나만
// 받아야 하므로 같은 조합도 거부하며, 모델이 두 계약을 혼동하지 않도록 설명에도 명시한다.
const EXACTLY_ONE_PARENT = 'Pass exactly one of planId, taskId, documentId, findingId — a comment has one parent by construction.';
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
        .describe('Plan comments carry a type, and it is required with planId — rejected with any other parent. RISK stops a runner executing the plan — do not use it lightly.'),
    affectedFiles: z
        .array(z.string().min(1))
        .optional()
        .describe('Repository paths this comment is about. Plan comments only — rejected with any other parent.'),
    content: z.string().min(1).describe('Comment body in Markdown.'),
    guideHash: guideHashField,
    idempotencyKey: idempotencyKeyField,
});
/** Which parent this call targets, or a tool error naming exactly what is wrong with the shape. */
function resolveCommentParent(args) {
    const present = COMMENT_PARENT_KEYS.filter((key) => args[key] !== undefined);
    if (present.length === 0) {
        throw new Error(`agentteams_comment_create needs a parent. ${EXACTLY_ONE_PARENT}`);
    }
    if (present.length > 1) {
        throw new Error(`agentteams_comment_create received more than one parent: ${present.join(', ')}. ${EXACTLY_ONE_PARENT}`);
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
    const planOnly = ['type', 'affectedFiles'].filter((key) => args[key] !== undefined);
    if (planOnly.length > 0) {
        throw new Error(`agentteams_comment_create only accepts ${planOnly.join(', ')} with planId, but the parent is ${parent}.`);
    }
    return parent;
}
const commentCreateSpec = {
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
        'Returns the created comment id, its parent identifier, and updatedAt. A plan comment adds planWebUrl and a document comment adds documentWebUrl; task and finding comments return no link.',
        FULL_RECORD_VIA_GET,
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
            return projectWriteResponse(await createComment(context.apiUrl, context.projectId, headers, stripContextEntityIdPrefix(args.planId), {
                type: args.type,
                content: args.content,
                ...(args.affectedFiles ? { affectedFiles: args.affectedFiles } : {}),
                ...contract,
            }), COMMENT_SUMMARY_FIELDS);
        }
        if (parent === 'taskId') {
            return projectWriteResponse(await createTaskComment(context.apiUrl, context.projectId, headers, stripContextEntityIdPrefix(args.taskId), {
                content: args.content,
                ...contract,
            }), COMMENT_SUMMARY_FIELDS);
        }
        if (parent === 'findingId') {
            return projectWriteResponse(await createFindingComment(context.apiUrl, context.projectId, headers, stripContextEntityIdPrefix(args.findingId), { content: args.content, ...contract }), COMMENT_SUMMARY_FIELDS);
        }
        return projectWriteResponse(await createDocumentComment(context.apiUrl, context.projectId, headers, stripContextEntityIdPrefix(args.documentId), { content: args.content, ...contract }), COMMENT_SUMMARY_FIELDS);
    },
};
const commentUpdateSpec = {
    name: 'agentteams_comment_update',
    title: 'Update AgentTeams Comment',
    description: [
        'Edit a root comment. Only the author may edit; this refuses a reply id (use agentteams_comment_reply_update).',
        COMMENT_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_comment_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated comment id, its parent target, updatedAt, and the webUrl of the parent screen a human can open.',
        FULL_RECORD_VIA_GET,
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
        return projectWriteResponse(await updateComment(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.commentId), definedFields({
            content: args.content,
            type: args.type,
            affectedFiles: args.affectedFiles,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), COMMENT_SUMMARY_FIELDS);
    },
};
const commentDeleteSpec = {
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
        const commentId = stripContextEntityIdPrefix(args.commentId);
        await deleteComment(context.apiUrl, context.projectId, await auth(context), commentId, definedFields({
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        }));
        return { deleted: true, id: commentId };
    },
};
const commentReplyCreateSpec = {
    name: 'agentteams_comment_reply_create',
    title: 'Reply to an AgentTeams Comment',
    description: [
        'Add a reply to a root comment. The reply inherits the root comment’s target; you do not choose one.',
        'Replies are one level deep — a reply cannot be the parent of another reply, and passing a reply id here is rejected.',
        COMMENT_GUIDE_FIRST,
        PROJECT_SCOPE,
        'Returns the created reply id, its parent comment, updatedAt, and the webUrl of the parent screen a human can open.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: commentWriteDiscovery,
    inputSchema: z.strictObject({
        commentId: commentIdField,
        content: z.string().min(1).describe('Reply body in Markdown.'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        return projectWriteResponse(await createReply(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.commentId), definedFields({
            content: args.content,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
            agentConfigId: context.agentConfigId,
        })), COMMENT_SUMMARY_FIELDS);
    },
};
const commentReplyUpdateSpec = {
    name: 'agentteams_comment_reply_update',
    title: 'Update AgentTeams Comment Reply',
    description: [
        'Edit a reply. Only the author may edit; this refuses a root comment id (use agentteams_comment_update).',
        COMMENT_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_comment_reply_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated reply id, its parent comment, updatedAt, and the webUrl of the parent screen a human can open.',
        FULL_RECORD_VIA_GET,
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
        return projectWriteResponse(await updateReply(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.replyId), definedFields({
            content: args.content,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), COMMENT_SUMMARY_FIELDS);
    },
};
const commentReplyDeleteSpec = {
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
        const replyId = stripContextEntityIdPrefix(args.replyId);
        await deleteReply(context.apiUrl, context.projectId, await auth(context), replyId, definedFields({
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        }));
        return { deleted: true, id: replyId };
    },
};
const coActionCreateSpec = {
    name: 'agentteams_coaction_create',
    title: 'Create AgentTeams Co-Action',
    description: [
        'Create a co-action (handoff record) in this project.',
        CO_ACTION_GUIDE_FIRST,
        PROJECT_SCOPE,
        'Returns the created co-action id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: coActionWriteDiscovery,
    inputSchema: z.strictObject({
        title: z.string().min(1).max(255).describe('Co-action title.'),
        content: z.string().min(1).describe('Co-action body in Markdown.'),
        planId: z.string().min(1).optional().describe('Related plan id (bare uuid or agentteams_pln_-prefixed).'),
        completionReportId: z
            .string()
            .min(1)
            .optional()
            .describe('Related completion report id (bare uuid or agentteams_rpt_-prefixed).'),
        postMortemId: z
            .string()
            .min(1)
            .optional()
            .describe('Related post-mortem id (bare uuid or agentteams_pmt_-prefixed).'),
        status: z.enum(['OPEN', 'CLOSED']).optional().describe('OPEN (default) or CLOSED.'),
        visibility: visibilityField,
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        requireOneOf('agentteams_coaction_create', args, ['planId', 'completionReportId', 'postMortemId']);
        return projectWriteResponse(await createCoAction(context.apiUrl, context.projectId, await auth(context), definedFields({
            title: args.title,
            content: args.content,
            planId: typeof args.planId === 'string' ? stripContextEntityIdPrefix(args.planId) : undefined,
            completionReportId: typeof args.completionReportId === 'string'
                ? stripContextEntityIdPrefix(args.completionReportId)
                : undefined,
            postMortemId: typeof args.postMortemId === 'string' ? stripContextEntityIdPrefix(args.postMortemId) : undefined,
            status: args.status,
            visibility: args.visibility,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const coActionUpdateSpec = {
    name: 'agentteams_coaction_update',
    title: 'Update AgentTeams Co-Action',
    description: [
        'Update an existing co-action, including status transitions such as OPEN → CLOSED.',
        CO_ACTION_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_coaction_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated co-action id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: coActionWriteDiscovery,
    inputSchema: z.strictObject({
        id: z.string().min(1).describe('Co-action id (bare uuid or agentteams_act_-prefixed).'),
        title: z.string().min(1).max(255).optional().describe('New title.'),
        content: z.string().min(1).optional().describe('New body in Markdown. Replaces the whole body.'),
        status: z.enum(['OPEN', 'CLOSED']).optional().describe('Status transition. OPEN or CLOSED.'),
        visibility: visibilityField,
        expectedUpdatedAt: expectedUpdatedAtFieldFor('co-action'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        requireOneOf('agentteams_coaction_update', args, ['title', 'content', 'status', 'visibility']);
        return projectWriteResponse(await updateCoAction(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.id), definedFields({
            title: args.title,
            content: args.content,
            status: args.status,
            visibility: args.visibility,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const coActionDeleteSpec = {
    name: 'agentteams_coaction_delete',
    title: 'Delete AgentTeams Co-Action',
    description: [
        'Delete a co-action from this project. This is destructive and cannot be undone.',
        CO_ACTION_GUIDE_FIRST,
        'Without expectedUpdatedAt this is an unconditional delete: it removes the co-action even if someone edited it after you last read it.',
        'Pass expectedUpdatedAt (from agentteams_coaction_get) unless you intend that.',
        'Confirm with the user before deleting anything you did not just create.',
        PROJECT_SCOPE,
    ].join(' '),
    discovery: coActionWriteDiscovery,
    inputSchema: z.strictObject({
        id: z.string().min(1).describe('Co-action id (bare uuid or agentteams_act_-prefixed).'),
        expectedUpdatedAt: expectedUpdatedAtFieldFor('co-action'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        const coActionId = stripContextEntityIdPrefix(args.id);
        await deleteCoAction(context.apiUrl, context.projectId, await auth(context), coActionId, definedFields({
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        }));
        return { deleted: true, id: coActionId };
    },
};
const postMortemCreateSpec = {
    name: 'agentteams_postmortem_create',
    title: 'Create AgentTeams Post-Mortem',
    description: [
        'Create a plan-linked post-mortem or a standalone service-incident post-mortem. Create one only when a reproducible or systematic failure delayed or blocked the work and there is a preventable cause.',
        POST_MORTEM_GUIDE_FIRST,
        PROJECT_SCOPE,
        'Returns the created post-mortem id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: postMortemWriteDiscovery,
    inputSchema: z.strictObject({
        planId: z
            .string()
            .min(1)
            .optional()
            .describe('Optional related plan id (bare uuid or agentteams_pln_-prefixed). Omit for a service incident.'),
        title: z.string().min(1).max(255).describe('Post-mortem title.'),
        content: z.string().min(50).describe('Post-mortem body in Markdown. Must be at least 50 characters.'),
        actionItems: z.array(z.string().min(1)).min(1).describe('Follow-up action items. At least one is required.'),
        status: z
            .enum(['OPEN', 'IN_PROGRESS', 'RESOLVED'])
            .optional()
            .describe('OPEN (default), IN_PROGRESS, or RESOLVED.'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        return projectWriteResponse(await createPostMortem(context.apiUrl, context.projectId, await auth(context), definedFields({
            planId: typeof args.planId === 'string' ? stripContextEntityIdPrefix(args.planId) : undefined,
            title: args.title,
            content: args.content,
            actionItems: args.actionItems,
            status: args.status,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const postMortemUpdateSpec = {
    name: 'agentteams_postmortem_update',
    title: 'Update AgentTeams Post-Mortem',
    description: [
        'Update an existing post-mortem. Only the fields you pass are changed.',
        POST_MORTEM_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_postmortem_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated post-mortem id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: postMortemWriteDiscovery,
    inputSchema: z.strictObject({
        id: z.string().min(1).describe('Post-mortem id (bare uuid or agentteams_pmt_-prefixed).'),
        title: z.string().min(1).max(255).optional().describe('New title.'),
        content: z.string().min(50).optional().describe('New body in Markdown. Replaces the whole body.'),
        actionItems: z.array(z.string().min(1)).min(1).optional().describe('Replacement follow-up action items.'),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional().describe('New status.'),
        expectedUpdatedAt: expectedUpdatedAtFieldFor('post-mortem'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        requireOneOf('agentteams_postmortem_update', args, ['title', 'content', 'actionItems', 'status']);
        return projectWriteResponse(await updatePostMortem(context.apiUrl, context.projectId, await auth(context), stripContextEntityIdPrefix(args.id), definedFields({
            title: args.title,
            content: args.content,
            actionItems: args.actionItems,
            status: args.status,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const codeReviewCreateSpec = {
    name: 'agentteams_codereview_create',
    title: 'Create AgentTeams Code Review',
    description: [
        'Create a code review for local diffs, git commit ranges, or pull requests. Findings can be supplied upfront when already known.',
        CODE_REVIEW_GUIDE_FIRST,
        PROJECT_SCOPE,
        'Returns the created code review id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: codeReviewWriteDiscovery,
    inputSchema: z.strictObject({
        title: z.string().min(1).max(255).describe('Code review title.'),
        targetType: z
            .enum(CODE_REVIEW_TARGET_TYPE_VALUES)
            .optional()
            .describe('Target inspection type from the API CodeReviewTargetType contract.'),
        targetRef: z.string().min(1).max(500).optional().describe('Target reference (commit range, PR number or URL).'),
        repositoryRemoteUrl: z.string().min(1).optional().describe('Git remote repository URL.'),
        sourcePlanId: z
            .string()
            .min(1)
            .optional()
            .describe('Optional source plan id (bare uuid or agentteams_pln_-prefixed).'),
        sourceCompletionReportId: z
            .string()
            .min(1)
            .optional()
            .describe('Optional source completion report id (bare uuid or agentteams_rpt_-prefixed).'),
        sourceCommitStart: z.string().min(1).optional().describe('Source starting commit hash.'),
        sourceCommitEnd: z.string().min(1).optional().describe('Source ending commit hash.'),
        sourceBranchName: z.string().min(1).optional().describe('Source branch name.'),
        baseBranchName: z.string().min(1).optional().describe('Base branch name.'),
        diffSummary: z.string().optional().describe('Summary of the diff inspected.'),
        testSummary: z.string().optional().describe('Summary of test results.'),
        reviewerContext: z.string().optional().describe('Reviewer instructions or context.'),
        recommendationReason: z.string().optional().describe('Reason for recommending this code review.'),
        runnerType: z.enum(RUNNER_TYPE_VALUES).optional().describe('Runner type performing or requesting the review.'),
        model: z.string().min(1).optional().describe('Model snapshot used for the review.'),
        resultSummary: z
            .string()
            .optional()
            .describe('Review conclusion in the required three-block format: Verdict, What changes for people, and Remaining actions. Must be sent together with findings.'),
        findings: z
            .array(z.strictObject({
            severity: z.enum(['P0', 'P1', 'P2', 'P3']).describe('Severity level (P0, P1, P2, P3).'),
            impactArea: z.enum(CODE_REVIEW_FINDING_IMPACT_AREA_VALUES).describe('Primary impact area for this finding.'),
            title: z.string().min(1).max(255).describe('Finding title.'),
            filePath: z.string().min(1).describe('Relative file path.'),
            lineStart: z.number().int().positive().optional().describe('Starting line number.'),
            lineEnd: z.number().int().positive().optional().describe('Ending line number.'),
            problem: z.string().min(1).describe('Problem description.'),
            impact: z.string().min(1).describe('Impact of the problem.'),
            suggestion: z.string().min(1).describe('Concrete suggestion to resolve.'),
        }))
            .optional()
            .describe('Initial review findings.'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        validateInitialCodeReviewFindings(args);
        validateInitialCodeReviewResultSummary(args);
        return projectWriteResponse(await createCodeReview(context.apiUrl, context.projectId, await auth(context), definedFields({
            title: args.title,
            targetType: args.targetType,
            targetRef: args.targetRef,
            repositoryRemoteUrl: args.repositoryRemoteUrl,
            sourcePlanId: typeof args.sourcePlanId === 'string' ? stripContextEntityIdPrefix(args.sourcePlanId) : undefined,
            sourceCompletionReportId: typeof args.sourceCompletionReportId === 'string'
                ? stripContextEntityIdPrefix(args.sourceCompletionReportId)
                : undefined,
            sourceCommitStart: args.sourceCommitStart,
            sourceCommitEnd: args.sourceCommitEnd,
            sourceBranchName: args.sourceBranchName,
            baseBranchName: args.baseBranchName,
            diffSummary: args.diffSummary,
            testSummary: args.testSummary,
            reviewerContext: args.reviewerContext,
            recommendationReason: args.recommendationReason,
            runnerType: args.runnerType,
            model: args.model,
            resultSummary: args.resultSummary,
            findings: args.findings,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const codeReviewUpdateSpec = {
    name: 'agentteams_codereview_update',
    title: 'Update AgentTeams Code Review',
    description: [
        'Update an existing code review metadata or cancel a pending code review.',
        CODE_REVIEW_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_codereview_get) so a concurrent edit is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the updated code review id, status, updatedAt, and webUrl.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: codeReviewWriteDiscovery,
    inputSchema: z.strictObject({
        id: z.string().min(1).describe('Code review id (bare uuid or agentteams_rev_-prefixed).'),
        title: z.string().min(1).max(255).optional().describe('New title.'),
        status: z.enum(['CANCELLED']).optional().describe('Status transition. CANCELLED cancels a pending code review.'),
        targetType: z.enum(CODE_REVIEW_TARGET_TYPE_VALUES).optional().describe('New target inspection type.'),
        targetRef: z.string().min(1).max(500).optional().describe('New target reference.'),
        sourceCommitStart: z.string().min(1).optional().describe('New starting commit hash.'),
        sourceCommitEnd: z.string().min(1).optional().describe('New ending commit hash.'),
        sourceBranchName: z.string().min(1).optional().describe('New source branch name.'),
        baseBranchName: z.string().min(1).optional().describe('New base branch name.'),
        diffSummary: z.string().optional().describe('New summary of the diff.'),
        testSummary: z.string().optional().describe('New summary of test results.'),
        reviewerContext: z.string().optional().describe('New reviewer context.'),
        recommendationReason: z.string().optional().describe('New recommendation reason.'),
        runnerType: z.enum(RUNNER_TYPE_VALUES).optional().describe('New runner type.'),
        model: z.string().min(1).optional().describe('New model snapshot.'),
        expectedUpdatedAt: expectedUpdatedAtFieldFor('code review'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        requireOneOf('agentteams_codereview_update', args, ['status', ...CODE_REVIEW_UPDATE_METADATA_FIELDS]);
        validateCodeReviewCancellation(args);
        const reviewId = stripContextEntityIdPrefix(args.id);
        if (args.status === 'CANCELLED') {
            return projectWriteResponse(await cancelCodeReview(context.apiUrl, context.projectId, await auth(context), reviewId, definedFields({
                guideHash: args.guideHash,
                idempotencyKey: args.idempotencyKey,
            })), REVIEW_SUMMARY_FIELDS);
        }
        return projectWriteResponse(await updateCodeReview(context.apiUrl, context.projectId, await auth(context), reviewId, definedFields({
            title: args.title,
            targetType: args.targetType,
            targetRef: args.targetRef,
            sourceCommitStart: args.sourceCommitStart,
            sourceCommitEnd: args.sourceCommitEnd,
            sourceBranchName: args.sourceBranchName,
            baseBranchName: args.baseBranchName,
            diffSummary: args.diffSummary,
            testSummary: args.testSummary,
            reviewerContext: args.reviewerContext,
            recommendationReason: args.recommendationReason,
            runnerType: args.runnerType,
            model: args.model,
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        })), REVIEW_SUMMARY_FIELDS);
    },
};
const codeReviewFindingStatusSetSpec = {
    name: 'agentteams_codereview_finding_status_set',
    title: 'Set AgentTeams Code Review Finding Status',
    description: [
        'Change the status of a single code review finding (DISMISSED to dismiss, OPEN to undismiss, RESOLVED to mark resolved).',
        CODE_REVIEW_GUIDE_FIRST,
        'Pass expectedUpdatedAt (from agentteams_codereview_finding_get) so a concurrent transition is rejected rather than silently overwritten.',
        PROJECT_SCOPE,
        'Returns the parent review id, status, updatedAt, and webUrl, plus the changed finding id, status, and updatedAt.',
        FULL_RECORD_VIA_GET,
    ].join(' '),
    discovery: codeReviewWriteDiscovery,
    inputSchema: z.strictObject({
        codeReviewId: z.string().min(1).describe('Parent code review id (bare uuid or agentteams_rev_-prefixed).'),
        findingId: z.string().min(1).describe('Finding id (bare uuid or agentteams_rvf_-prefixed).'),
        status: z
            .enum(['OPEN', 'DISMISSED', 'RESOLVED'])
            .describe('New status: DISMISSED to dismiss, OPEN to undismiss/reopen, RESOLVED to mark resolved.'),
        expectedUpdatedAt: expectedUpdatedAtFieldFor('code review finding'),
        guideHash: guideHashField,
        idempotencyKey: idempotencyKeyField,
    }),
    handler: async (args, context) => {
        const codeReviewId = stripContextEntityIdPrefix(args.codeReviewId);
        const findingId = stripContextEntityIdPrefix(args.findingId);
        const body = definedFields({
            expectedUpdatedAt: args.expectedUpdatedAt,
            guideHash: args.guideHash,
            idempotencyKey: args.idempotencyKey,
        });
        const headers = await auth(context);
        // findingId 원본(args, prefix 포함 가능)을 넘긴다. 서버 응답 안 finding id는 bare라
        // 투영 헬퍼 안에서 prefix를 벗겨 대조한다.
        if (args.status === 'DISMISSED') {
            return projectFindingStatusResponse(await dismissCodeReviewFinding(context.apiUrl, context.projectId, headers, codeReviewId, findingId, body), args.findingId);
        }
        if (args.status === 'OPEN') {
            return projectFindingStatusResponse(await undismissCodeReviewFinding(context.apiUrl, context.projectId, headers, codeReviewId, findingId, body), args.findingId);
        }
        return projectFindingStatusResponse(await resolveCodeReviewFinding(context.apiUrl, context.projectId, headers, codeReviewId, findingId, body), args.findingId);
    },
};
/** Every write tool the CLI MCP server exposes, in registration order. */
export function getWriteToolSpecs() {
    return [
        documentCreateSpec,
        documentUpdateSpec,
        documentDeleteSpec,
        planDocumentLinkSpec,
        planDocumentUnlinkSpec,
        commentCreateSpec,
        commentUpdateSpec,
        commentDeleteSpec,
        commentReplyCreateSpec,
        commentReplyUpdateSpec,
        commentReplyDeleteSpec,
        coActionCreateSpec,
        coActionUpdateSpec,
        coActionDeleteSpec,
        postMortemCreateSpec,
        postMortemUpdateSpec,
        codeReviewCreateSpec,
        codeReviewUpdateSpec,
        codeReviewFindingStatusSetSpec,
    ];
}
//# sourceMappingURL=writeTools.js.map