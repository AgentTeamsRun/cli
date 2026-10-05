import { createApiKeyFileOption } from '../shared.js';
export function addConnectionOptions(command) {
    return command
        .option('--api-url <url>', 'Override API URL (optional)')
        .addOption(createApiKeyFileOption())
        .option('--project-id <id>', 'Override project ID (optional)');
}
//# sourceMappingURL=connection.js.map