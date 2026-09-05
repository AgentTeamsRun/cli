import type { InitOutputFormat } from './initOutput.js';
export declare function normalizeInteractiveFormat(format: unknown): InitOutputFormat;
export declare function executeValidatedInteractiveCommand<T>(requestedFormat: unknown, execute: () => Promise<T>): Promise<{
    result: T;
    format: InitOutputFormat;
}>;
//# sourceMappingURL=interactiveCommand.d.ts.map