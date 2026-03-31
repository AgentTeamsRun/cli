import { readFileSync } from 'node:fs';
import { getHarnessConfig, updateHarnessConfig } from '../api/harnessConfig.js';
import { withSpinner } from '../utils/spinner.js';
import { toNonEmptyString } from '../utils/parsers.js';

export async function executeHarnessCommand(
  apiUrl: string,
  projectId: string,
  headers: Record<string, string>,
  action: string,
  options: Record<string, unknown>
): Promise<unknown> {
  switch (action) {
    case 'get': {
      const result = await withSpinner('Fetching harness config...', () =>
        getHarnessConfig(apiUrl, projectId, headers)
      );
      return result;
    }
    case 'set': {
      const filePath = toNonEmptyString(options.file);

      if (!filePath) {
        throw new Error('--file is required for harness set');
      }

      const content = readFileSync(filePath, 'utf8');
      const config = JSON.parse(content) as Record<string, unknown>;

      const result = await withSpinner('Updating harness config...', () =>
        updateHarnessConfig(apiUrl, projectId, headers, config)
      );

      console.log('Harness config updated');
      return result;
    }
    default:
      throw new Error(`Unknown harness action: ${action}. Available: get, set`);
  }
}
