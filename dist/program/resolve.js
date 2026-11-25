import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
/**
 * 액션 인벤토리: 액션: get. 실사용 옵션: ref. 별칭/도움말 불일치: 없음.
 */
export function registerResolveCommand(program) {
    program
        .command('resolve')
        .description('Resolve an entity reference token to the right entity and fetch it')
        .argument('<ref>', 'Reference token, e.g. "plan:agentteams_pln_<uuid>", "agentteams_doc_<uuid>", or a whole [label](type:id) link')
        .option('--output-file <path>', 'Write full output to a file (stdout prints a short summary)')
        .option('--verbose', 'Print full raw output to stdout; with --output-file, also echo it', false)
        .addHelpText('after', `\nReturns a "kind" that tells you what to do next:\n  file       read "filePath" (the entity body was downloaded)\n  record     use "record" (structured payload, already inline)\n  localFile  read "filePath" (the reference carried a local path)\n  external   open "url" or run "suggestedCommand" (gh/glab)\n${CONVENTION_HINT}`)
        .action(async (ref, options) => {
        try {
            const result = await executeCommand('resolve', 'get', { ref });
            printCommandResult({
                result,
                outputFile: options.outputFile,
                verbose: options.verbose,
                resource: 'resolve',
                action: 'get',
            });
        }
        catch (error) {
            console.error(handleError(error));
            process.exit(1);
        }
    });
}
//# sourceMappingURL=resolve.js.map