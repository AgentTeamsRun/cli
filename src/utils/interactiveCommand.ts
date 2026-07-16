import type { InitOutputFormat } from './initOutput.js';

export function normalizeInteractiveFormat(format: unknown): InitOutputFormat {
  if (format === undefined || format === null || format === '') return 'human';
  if (format === 'json') return 'json';
  throw new Error(
    `Unsupported output format: ${String(format)}. Use json or omit --format for the human-readable view.`,
  );
}

export async function executeValidatedInteractiveCommand<T>(
  requestedFormat: unknown,
  execute: () => Promise<T>,
): Promise<{ result: T; format: InitOutputFormat }> {
  const format = normalizeInteractiveFormat(requestedFormat);
  const result = await execute();
  return { result, format };
}
