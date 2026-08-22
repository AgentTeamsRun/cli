export function normalizeInteractiveFormat(format) {
    if (format === undefined || format === null || format === '')
        return 'human';
    if (format === 'json')
        return 'json';
    throw new Error(`Unsupported output format: ${String(format)}. Use json or omit --format for the human-readable view.`);
}
export async function executeValidatedInteractiveCommand(requestedFormat, execute) {
    const format = normalizeInteractiveFormat(requestedFormat);
    const result = await execute();
    return { result, format };
}
//# sourceMappingURL=interactiveCommand.js.map