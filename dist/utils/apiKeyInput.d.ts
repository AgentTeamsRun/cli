export interface ApiKeyInputOptions {
    apiKeyFile?: string;
}
export interface ApiKeyInputDependencies {
    readFile: (path: string) => string;
    readStdin: () => string;
    warn: (message: string) => void;
}
/**
 * Resolve explicit credential input without ever writing the credential to
 * output.
 */
export declare function resolveApiKeyInput(options: ApiKeyInputOptions, dependencies?: ApiKeyInputDependencies): string | undefined;
//# sourceMappingURL=apiKeyInput.d.ts.map