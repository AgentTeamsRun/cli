import { describe, it, expect } from '@jest/globals';
import { getContextToolDefinitions } from '@agentteams/context-tools';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(cliRoot, 'src');

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * The MCP SDK is pinned to a beta whose surface will change on promotion. The
 * upgrade must only touch the adapter layer, so every SDK import — and with it
 * every MCP envelope assembly — is confined to `src/mcp/`. A violation here
 * means the promotion cost starts scaling with tool/resource count again.
 */
describe('mcp sdk boundary', () => {
  it('imports @modelcontextprotocol/server only under src/mcp/', () => {
    const violations = collectSourceFiles(srcRoot)
      .filter((file) => !relative(srcRoot, file).startsWith(`mcp${sep}`))
      .filter((file) => readFileSync(file, 'utf-8').includes('@modelcontextprotocol/server'));

    expect(violations.map((file) => relative(cliRoot, file))).toEqual([]);
  });

  it.each([['.registerTool('], ['.registerResource(']])(
    'keeps %s calls inside the adapter registration loop only',
    (registration) => {
      const filesWithRegistration = collectSourceFiles(srcRoot)
        .filter((file) => readFileSync(file, 'utf-8').includes(registration))
        .map((file) => relative(srcRoot, file).replaceAll(sep, '/'));

      expect(filesWithRegistration).toEqual(['mcp/server.ts']);
    },
  );
});

/**
 * `desktop/src/main/localAgent/directRunner.ts` advertises every context-tool
 * definition to the model with no filter. So the moment a write tool is added to
 * `@agentteams/context-tools`, a Direct BYOK (`DESKTOP_LIMITED`) conversation
 * gets project write access it was never granted. Write tools therefore live in
 * `cli/src/mcp/writeTools.ts` and nowhere else.
 */
describe('shared context-tools package boundary', () => {
  it('advertises read tools only — no create/update/delete', () => {
    const names = getContextToolDefinitions().map((definition) => definition.name);

    expect(names.filter((name) => /_(create|update|delete)$/.test(name))).toEqual([]);
    expect(names).not.toContain('agentteams_guide_get');
  });
});
