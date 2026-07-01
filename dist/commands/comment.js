import { createComment, createReply, deleteComment, deleteReply, getComment, listComments, listReplies, updateComment, updateReply, } from '../api/comment.js';
import { toPositiveInteger } from '../utils/parsers.js';
export async function executeCommentCommand(apiUrl, projectId, headers, action, options) {
    switch (action) {
        case 'list': {
            if (!options.planId)
                throw new Error('--plan-id is required for comment list');
            const params = {};
            if (options.type)
                params.type = options.type;
            const page = toPositiveInteger(options.page);
            const pageSize = toPositiveInteger(options.pageSize);
            if (page !== undefined)
                params.page = page;
            if (pageSize !== undefined)
                params.pageSize = pageSize;
            return listComments(apiUrl, projectId, headers, options.planId, params);
        }
        case 'get': {
            if (!options.id)
                throw new Error('--id is required for comment get');
            return getComment(apiUrl, projectId, headers, options.id);
        }
        case 'create': {
            if (!options.planId)
                throw new Error('--plan-id is required for comment create');
            if (!options.type)
                throw new Error('--type is required for comment create');
            if (!options.content)
                throw new Error('--content is required for comment create');
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