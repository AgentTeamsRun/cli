import { CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';
export function registerDependencyCommand(program) {
    const root = program
        .command('dependency')
        .description('Manage plan dependencies')
        .addHelpText('after', CONVENTION_HINT);
    const addLeaf = (action, description, configure) => addJsonResourceLeaf(root, 'dependency', action, description, configure, {
        connection: false,
    });
    addLeaf('list', 'List plan dependencies', (command) => command.option('--plan-id <id>', 'Plan ID'));
    addLeaf('create', 'Create a plan dependency', (command) => command.option('--plan-id <id>', 'Plan ID').option('--blocking-plan-id <id>', 'Blocking plan ID'));
    addLeaf('delete', 'Delete a plan dependency', (command) => command.option('--plan-id <id>', 'Plan ID').option('--dep-id <id>', 'Dependency ID to delete'));
}
//# sourceMappingURL=dependency.js.map