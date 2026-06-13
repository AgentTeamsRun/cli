import ora, { type Ora } from 'ora';
import chalk from 'chalk';

const isInteractive = process.stderr.isTTY === true;

export async function withSpinner<T>(text: string, fn: () => Promise<T>, successText?: string): Promise<T> {
  if (!isInteractive) return fn();

  const spinner = ora({ text, stream: process.stderr }).start();
  try {
    const result = await fn();
    spinner.succeed(successText);
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export function createSpinner(text: string): Ora | null {
  if (!isInteractive) return null;
  return ora({ text, stream: process.stderr }).start();
}

export function formatFileInfo(filePath: string, content: string): string {
  const bytes = Buffer.byteLength(content, 'utf-8');
  const lines = content.split('\n').length;
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return `${chalk.cyan(filePath)} ${chalk.dim(`(${size}, ${lines} lines)`)}`;
}

export function formatFileSizeInfo(filePath: string, bytes: number): string {
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return `${chalk.cyan(filePath)} ${chalk.dim(`(${size})`)}`;
}

export function printFileInfo(filePath: string, content: string): void {
  if (!isInteractive) return;
  process.stderr.write(`  ${formatFileInfo(filePath, content)}\n`);
}

export function printFileSizeInfo(filePath: string, bytes: number): void {
  if (!isInteractive) return;
  process.stderr.write(`  ${formatFileSizeInfo(filePath, bytes)}\n`);
}
