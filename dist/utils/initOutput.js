import chalk from 'chalk';
import { formatOutput } from './formatter.js';
function isInitResult(result) {
    if (!result || typeof result !== 'object')
        return false;
    const r = result;
    return (r.success === true &&
        typeof r.agentName === 'string' &&
        typeof r.configPath === 'string' &&
        typeof r.conventionPath === 'string');
}
export function printInitResult(result, format) {
    if (format === 'json') {
        const outputText = typeof result === 'string' ? result : formatOutput(result, format);
        console.log(outputText);
        return;
    }
    if (!isInitResult(result)) {
        const outputText = typeof result === 'string' ? result : formatOutput(result, format);
        console.log(outputText);
        return;
    }
    console.log(`✓ Authenticated as ${result.agentName}`);
    console.log(`✓ Config saved:      ${result.configPath}`);
    console.log(`✓ Convention saved:  ${result.conventionPath}`);
    console.log(`✓ Conventions synced to .agentteams/`);
    if (result.agentFiles && result.agentFiles.length > 0) {
        for (const file of result.agentFiles) {
            if (file.type === 'created') {
                console.log(`✓ Agent file created: ${file.relativePath}`);
            }
            else {
                console.log(`✓ Example file created: ${file.relativePath}`);
            }
        }
    }
    console.log('');
    console.log('Next steps:');
    console.log('  1. Check the generated agent files (CLAUDE.md, AGENTS.md, etc.)');
    console.log('     If a -example file was created, merge it into your existing file.');
    console.log('  2. Set up conventions for your project by saying to your AI agent:');
    console.log(chalk.cyan('       Read .agentteams/platform/convention-setup-guide.md and create conventions for this project.'));
    console.log('  3. Or try other commands:');
    console.log(chalk.cyan('       Create a plan to improve test coverage for this project.'));
}
//# sourceMappingURL=initOutput.js.map