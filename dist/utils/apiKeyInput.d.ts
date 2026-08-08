export interface ApiKeyInputOptions {
    apiKey?: string;
    apiKeyFile?: string;
}
export interface ApiKeyInputDependencies {
    readFile: (path: string) => string;
    readStdin: () => string;
    warn: (message: string) => void;
}
/**
 * Resolve explicit credential input without ever writing the credential to
 * output. The legacy argv path remains compatible, but every use explains the
 * safer environment, file and stdin alternatives on stderr.
 */
export declare function resolveApiKeyInput(options: ApiKeyInputOptions, dependencies?: ApiKeyInputDependencies): string | undefined;
//# sourceMappingURL=apiKeyInput.d.ts.map