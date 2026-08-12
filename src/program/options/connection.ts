import type { Command } from 'commander';
import { createApiKeyFileOption } from '../shared.js';

export function addConnectionOptions(command: Command): Command {
  return command
    .option('--api-url <url>', 'Override API URL (optional)')
    .addOption(createApiKeyFileOption())
    .option('--project-id <id>', 'Override project ID (optional)');
}
