import { CONVENTION_HINT, executeCommand, handleError, printCommandResult } from '../shared.js';
import { addConnectionOptions } from './connection.js';
import { addOutputOptions } from './output.js';
export function addJsonResourceLeaf(parent, resource, action, description, configure = (command) => command, options = {}) {
    let command = configure(parent.command(action).description(description));
    if (options.connection !== false)
        command = addConnectionOptions(command);
    command = addOutputOptions(command).addHelpText('after', CONVENTION_HINT);
    command.action(async (leafOptions) => {
        try {
            const { outputFile, verbose, ...actionOptions } = leafOptions;
            const commandAction = options.commandAction ?? action;
            const result = await executeCommand(resource, commandAction, actionOptions);
            printCommandResult({
                result,
                outputFile,
                verbose,
                resource,
                action: commandAction,
            });
        }
        catch (error) {
            console.error(handleError(error));
            process.exit(1);
        }
    });
    return command;
}
//# sourceMappingURL=resource.js.map