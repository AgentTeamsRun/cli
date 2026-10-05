import { dependencyCreate, dependencyDelete, dependencyList } from './dependency.js';
export async function executeDependencyCommand(action, options) {
    switch (action) {
        case 'list': {
            if (!options.planId)
                throw new Error('--plan-id is required for dependency list');
            return dependencyList(options.planId);
        }
        case 'create': {
            if (!options.planId)
                throw new Error('--plan-id is required for dependency create');
            if (!options.blockingPlanId)
                throw new Error('--blocking-plan-id is required for dependency create');
            return dependencyCreate(options.planId, options.blockingPlanId);
        }
        case 'delete': {
            if (!options.planId)
                throw new Error('--plan-id is required for dependency delete');
            if (!options.depId)
                throw new Error('--dep-id is required for dependency delete');
            return dependencyDelete(options.planId, options.depId);
        }
        default:
            throw new Error(`Unknown dependency action: ${action}. Use list, create, or delete.`);
    }
}
//# sourceMappingURL=dependencyCommand.js.map