export declare const normalizeCommandContext: (resource: string, action?: string) => string;
export declare const withCommandContext: <T>(command: string, operation: () => Promise<T>) => Promise<T>;
export declare const getCommandContext: () => string;
//# sourceMappingURL=commandContext.d.ts.map