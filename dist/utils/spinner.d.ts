import { type Ora } from 'ora';
export declare function withSpinner<T>(text: string, fn: () => Promise<T>, successText?: string): Promise<T>;
export declare function createSpinner(text: string): Ora | null;
export declare function formatFileInfo(filePath: string, content: string): string;
export declare function formatFileSizeInfo(filePath: string, bytes: number): string;
export declare function printFileInfo(filePath: string, content: string): void;
export declare function printFileSizeInfo(filePath: string, bytes: number): void;
//# sourceMappingURL=spinner.d.ts.map