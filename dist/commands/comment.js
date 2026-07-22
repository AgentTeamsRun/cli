import { createComment, createFindingComment, createReply, createTaskComment, deleteComment, deleteReply, getComment, listComments, listFindingComments, listReplies, listTaskComments, updateComment, updateReply, } from '../api/comment.js';
import { toPositiveInteger } from '../utils/parsers.js';
export async function executeCommentCommand(apiUrl, projectId, headers, action, options) {
    const targetKinds = [
        options.findingId && 'finding',
        options.taskId && 'task',
        options.planId && !options.taskId && 'plan',
    ].filter(Boolean);
    const requireTarget = (actionName) => {
        if (targetKinds.length === 0) {
            throw new Error(`--plan-id, --finding-id, or --task-id is required for comment ${actionName}`);
        }
        if (targetKinds.length > 1) {
            throw new Error('Use only one comment target: --plan-id, --finding-id, or --task-id');
        }
    };
    switch (action) {
        case 'list': {
            requireTarget('list');
            const params = {};
            if (options.planId && !options.taskId && options.type)
                params.type = options.type;
            if (options.taskId && options.planId)
                params.planId = options.planId;
            const page = toPositiveInteger(options.page);
            const pageSize = toPositiveInteger(options.pageSize);
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            if (options.findingId) {
                return listFindingComments(apiUrl, projectId, headers, options.findingId, params);
            }
            if (options.taskId) {
                return listTaskComments(apiUrl, projectId, headers, options.taskId, params);
            }
            return listComments(apiUrl, projectId, headers, options.planId, params);
        }
        case 'get': {
            if (!options.id)
                throw new Error('--id is required for comment get');
            return getComment(apiUrl, projectId, headers, options.id);
        }
        case 'create': {
            requireTarget('create');
            if (options.planId && !options.taskId && !options.type) {
                throw new Error('--type is required for plan comment create');
            }
            if (!options.content)
                throw new Error('--content is required for comment create');
            if (options.findingId) {
                if (options.type || options.affectedFiles) {
                    throw new Error('--type and --affected-files are only supported with --plan-id');
                }
                return createFindingComment(apiUrl, projectId, headers, options.findingId, {
                    content: options.content,
                });
            }
            if (options.taskId) {
                if (options.type || options.affectedFiles) {
                    throw new Error('--type and --affected-files are only supported with a plan comment target');
                }
                return createTaskComment(apiUrl, projectId, headers, options.taskId, { content: options.content }, options.planId);
            }
            const body = {
                type: options.type,
                content: options.content,
            };
            if (options.affectedFiles) {
                body.affectedFiles = options.affectedFiles.split(',').map((f) => f.trim());
            }
            return createComment(apiUrl, projectId, headers, options.planId, body);
        }
        case 'update': {
            if (!options.id)
                throw new Error('--id is required for comment update');
            if (!options.content)
                throw new Error('--content is required for comment update');
            const body = {
                content: options.content,
            };
            if (options.affectedFiles) {
                body.affectedFiles = options.affectedFiles.split(',').map((f) => f.trim());
            }
            return updateComment(apiUrl, projectId, headers, options.id, body);
        }
        case 'delete': {
            if (!options.id)
                throw new Error('--id is required for comment delete');
            await deleteComment(apiUrl, projectId, headers, options.id);
            return { message: `Comment ${options.id} deleted successfully` };
        }
        case 'reply-list': {
            if (!options.id)
                throw new Error('--id is required for comment reply-list');
            const params = {};
            const page = toPositiveInteger(options.page);
            const pageSize = toPositiveInteger(options.pageSize);
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return listReplies(apiUrl, projectId, headers, options.id, params);
        }
        case 'reply-create': {
            if (!options.id)
                throw new Error('--id is required for comment reply-create');
            if (!options.content)
                throw new Error('--content is required for comment reply-create');
            return createReply(apiUrl, projectId, headers, options.id, { content: options.content });
        }
        case 'reply-update': {
            if (!options.replyId)
                throw new Error('--reply-id is required for comment reply-update');
            if (!options.content)
                throw new Error('--content is required for comment reply-update');
            return updateReply(apiUrl, projectId, headers, options.replyId, { content: options.content });
        }
        case 'reply-delete': {
            if (!options.replyId)
                throw new Error('--reply-id is required for comment reply-delete');
            await deleteReply(apiUrl, projectId, headers, options.replyId);
            return { message: `Reply ${options.replyId} deleted successfully` };
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=comment.js.map