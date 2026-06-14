import { AsyncLocalStorage } from 'node:async_hooks';

const commandContext = new AsyncLocalStorage<string>();

export const normalizeCommandContext = (resource: string, action?: string): string => {
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

export const withCommandContext = async <T>(command: string, operation: () => Promise<T>): Promise<T> => {
  return commandContext.run(command, operation);
};

export const getCommandContext = (): string => commandContext.getStore() ?? 'unknown';
