import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const tscPath = join(cliRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const fixturePath = join(cliRoot, 'test', 'fixtures', 'context-tools-types.ts');

describe('context-tools public type contract', () => {
  it('does not expose bodyTiptap after omitting the document editor mirror', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          tscPath,
          '--ignoreConfig',
          '--noEmit',
          '--strict',
          '--skipLibCheck',
          '--target',
          'ES2022',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          fixturePath,
        ],
        { cwd: cliRoot, stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
});
