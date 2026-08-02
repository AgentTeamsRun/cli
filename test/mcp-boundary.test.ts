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

  // 답글 read 도구는 공유 패키지에 넣지만 write 도구는 넣지 않는다. 같은 엔티티의 도구가
  // 한 파일에 섞여 있으면 다음 사람이 "여기 답글 도구가 있으니 나머지도 여기에" 로 읽기 쉽다.
  it('carries the shared reply read tools but none of the comment write tools', () => {
    const names = getContextToolDefinitions().map((definition) => definition.name);

    expect(names).toContain('agentteams_comment_reply_list');
    expect(names).toContain('agentteams_comment_reply_get');
    for (const writeTool of [
      'agentteams_comment_create',
      'agentteams_comment_update',
      'agentteams_comment_delete',
      'agentteams_comment_reply_create',
      'agentteams_comment_reply_update',
      'agentteams_comment_reply_delete',
    ]) {
      expect(names).not.toContain(writeTool);
    }
  });
});
