export type ErrorContext = {
    apiUrl?: string;
};
export declare function attachErrorContext(error: unknown, context: ErrorContext): unknown;
export declare function handleError(error: unknown, context?: ErrorContext): string;
//# sourceMappingURL=errors.d.ts.map