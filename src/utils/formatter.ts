export function formatOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
