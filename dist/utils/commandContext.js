import { AsyncLocalStorage } from 'node:async_hooks';
const commandContext = new AsyncLocalStorage();
export const normalizeCommandContext = (resource, action) => {
    const normalizedResource = resource.trim().toLowerCase();
    const normalizedAction = action?.trim().toLowerCase();
    if (!normalizedResource) {
        return 'unknown';
    }
    if (!normalizedAction || normalizedResource === 'init' || normalizedResource === 'sync') {
        return normalizedResource;
    }
    return `${normalizedResource}:${normalizedAction}`;
};
export const withCommandContext = async (command, operation) => {
    return commandContext.run(command, operation);
};
export const getCommandContext = () => commandContext.getStore() ?? 'unknown';
//# sourceMappingURL=commandContext.js.map