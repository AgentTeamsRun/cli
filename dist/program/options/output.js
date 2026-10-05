export function addOutputOptions(command) {
    return command
        .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
        .option('--verbose', 'Print full raw output to stdout; with --output-file, also echo it', false);
}
//# sourceMappingURL=output.js.map