import ora from 'ora';
import chalk from 'chalk';
const isInteractive = process.stderr.isTTY === true;
export async function withSpinner(text, fn, successText) {
    if (!isInteractive)
        return fn();
    const spinner = ora({ text, stream: process.stderr }).start();
    try {
        const result = await fn();
        spinner.succeed(successText);
        return result;
    }
    catch (error) {
        spinner.fail();
        throw error;
    }
}
export function createSpinner(text) {
    if (!isInteractive)
        return null;
    return ora({ text, stream: process.stderr }).start();
}
export function formatFileInfo(filePath, content) {
    const bytes = Buffer.byteLength(content, 'utf-8');
    const lines = content.split('\n').length;
    const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    return `${chalk.cyan(filePath)} ${chalk.dim(`(${size}, ${lines} lines)`)}`;
}
export function printFileInfo(filePath, content) {
    if (!isInteractive)
        return;
    process.stderr.write(`  ${formatFileInfo(filePath, content)}\n`);
}
//# sourceMappingURL=spinner.js.map