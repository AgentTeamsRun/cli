import { type Ora } from 'ora';
export declare function withSpinner<T>(text: string, fn: () => Promise<T>, successText?: string): Promise<T>;
export declare function createSpinner(text: string): Ora | null;
export declare function formatFileInfo(filePath: string, content: string): string;
export declare function printFileInfo(filePath: string, content: string): void;
//# sourceMappingURL=spinner.d.ts.map