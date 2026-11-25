import { CONVENTION_HINT } from './shared.js';
import { addJsonResourceLeaf } from './options/resource.js';
const scheduleHelp = '\nRead-only. To change schedules, go to Project Settings > Schedules in the web app.';
const addPagination = (command) => command.option('--page <number>', 'Page number').option('--page-size <number>', 'Page size');
export function registerScheduleCommand(program) {
    const root = program
        .command('schedule')
        .description('Read runner schedules and their run history')
        .addHelpText('after', scheduleHelp)
        .addHelpText('after', CONVENTION_HINT);
    addJsonResourceLeaf(root, 'schedule', 'list', 'List runner schedules', addPagination).addHelpText('after', scheduleHelp);
    addJsonResourceLeaf(root, 'schedule', 'get', 'Get a runner schedule', (command) => command.requiredOption('--id <scheduleId>', 'Runner schedule ID')).addHelpText('after', scheduleHelp);
    addJsonResourceLeaf(root, 'schedule', 'runs', 'List runs for a runner schedule', (command) => addPagination(command.requiredOption('--id <scheduleId>', 'Runner schedule ID'))).addHelpText('after', scheduleHelp);
}
//# sourceMappingURL=schedule.js.map