import { addChangeSetItem, createChangeSet, deleteChangeSet, getChangeSet, listChangeSets, removeChangeSetItem, updateChangeSet, } from './changeSet.js';
import { toNonEmptyString, toPositiveInteger } from '../utils/parsers.js';
export async function executeChangeSetCommand(context, action, options) {
    switch (action) {
        case 'list':
            return listChangeSets(context, options);
        case 'get': {
            const id = toNonEmptyString(options.id);
            if (!id)
                throw new Error('--id is required for change-set get');
            return getChangeSet(context, id);
        }
        case 'create': {
            const title = toNonEmptyString(options.title);
            if (!title)
                throw new Error('--title is required for change-set create');
            return createChangeSet(context, title, toNonEmptyString(options.description));
        }
        case 'update': {
            const id = toNonEmptyString(options.id);
            if (!id)
                throw new Error('--id is required for change-set update');
            const body = {};
            for (const field of ['title', 'description', 'status']) {
                const value = toNonEmptyString(options[field]);
                if (value)
                    body[field] = value;
            }
            if (Object.keys(body).length === 0) {
                throw new Error('--title, --description, or --status is required for change-set update');
            }
            return updateChangeSet(context, id, body);
        }
        case 'delete': {
            const id = toNonEmptyString(options.id);
            if (!id)
                throw new Error('--id is required for change-set delete');
            return deleteChangeSet(context, id);
        }
        case 'add-item': {
            const changeSetId = toNonEmptyString(options.changeSetId);
            if (!changeSetId)
                throw new Error('--change-set-id is required for change-set add-item');
            const mergeOrder = toPositiveInteger(options.mergeOrder);
            if (!mergeOrder)
                throw new Error('--merge-order must be a positive integer for change-set add-item');
            return addChangeSetItem(context, changeSetId, mergeOrder, options);
        }
        case 'remove-item': {
            const changeSetId = toNonEmptyString(options.changeSetId);
            if (!changeSetId)
                throw new Error('--change-set-id is required for change-set remove-item');
            const itemId = toNonEmptyString(options.itemId);
            if (!itemId)
                throw new Error('--item-id is required for change-set remove-item');
            return removeChangeSetItem(context, changeSetId, itemId);
        }
        default:
            throw new Error(`Unknown change-set action: ${action}. Use create, list, get, update, delete, add-item, or remove-item.`);
    }
}
//# sourceMappingURL=changeSetCommand.js.map