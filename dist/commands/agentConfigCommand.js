import { agentConfigDelete, agentConfigGet, agentConfigList } from './agentConfig.js';
export async function executeAgentConfigCommand(action, options) {
    switch (action) {
        case 'list':
            return agentConfigList();
        case 'get': {
            if (!options.id)
                throw new Error('--id is required for agent-config get');
            return agentConfigGet(options.id);
        }
        case 'delete': {
            if (!options.id)
                throw new Error('--id is required for agent-config delete');
            return agentConfigDelete(options.id);
        }
        default:
            throw new Error(`Unknown agent-config action: ${action}. Use list, get, or delete.`);
    }
}
//# sourceMappingURL=agentConfigCommand.js.map