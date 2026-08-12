import { readFileSync } from 'node:fs';

export interface ApiKeyInputOptions {
  apiKeyFile?: string;
}

export interface ApiKeyInputDependencies {
  readFile: (path: string) => string;
  readStdin: () => string;
  warn: (message: string) => void;
}

const defaultDependencies: ApiKeyInputDependencies = {
  readFile: (path) => readFileSync(path, 'utf-8'),
  readStdin: () => readFileSync(0, 'utf-8'),
  warn: (message) => process.stderr.write(message),
};

const normalizeApiKey = (value: string, source: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${source} is empty.`);
  }
  if (/\s/.test(normalized)) {
    throw new Error(`${source} must contain exactly one API key without whitespace.`);
  }
  return normalized;
};

/**
 * Resolve explicit credential input without ever writing the credential to
 * output.
 */
export function resolveApiKeyInput(
  options: ApiKeyInputOptions,
  dependencies: ApiKeyInputDependencies = defaultDependencies,
): string | undefined {
  if (options.apiKeyFile === undefined) {
    return undefined;
  }

  const source = options.apiKeyFile === '-' ? 'stdin' : `API key file ${options.apiKeyFile}`;
  try {
    const value = options.apiKeyFile === '-' ? dependencies.readStdin() : dependencies.readFile(options.apiKeyFile);
    return normalizeApiKey(value, source);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.endsWith('is empty.') || error.message.includes('exactly one API key'))
    ) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${source}: ${detail}`);
  }
}
