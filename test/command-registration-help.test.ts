import { createHash } from 'node:crypto';
import { CommanderError } from 'commander';
import { createProgram } from '../src/program/index.js';

const BASELINE_HELP_SHA256: Record<string, string> = {
  init: 'b36b829aa0856709225939100e92e2ae824c24de695ff57af4ac04117af72a47',
  doctor: 'c8ccb727d8d02ba300d5077419ddccfb626713d266f8b8f85f7bbd03920c86ed',
  sync: 'c2089a5d0545ce3180759be24509a384676edde8109940e3ac38e9a3f1c57905',
};

async function renderHelp(commandName: string): Promise<string> {
  const program = createProgram('0.0.0');
  let output = '';
  program.configureOutput({ writeOut: (text) => (output += text) });
  const configureExitOverride = (command: typeof program): void => {
    command.exitOverride();
    for (const subcommand of command.commands) configureExitOverride(subcommand);
  };
  configureExitOverride(program);

  try {
    await program.parseAsync(['node', 'agentteams', ...(commandName === '<root>' ? [] : [commandName]), '--help'], {
      from: 'node',
    });
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== 'commander.helpDisplayed') throw error;
  }

  return output;
}

describe('커맨드 등록 모듈 분할', () => {
  it.each(Object.entries(BASELINE_HELP_SHA256))('%s 도움말을 바이트 단위로 보존한다', async (name, expected) => {
    const output = await renderHelp(name);
    expect(createHash('sha256').update(output).digest('hex')).toBe(expected);
  });
});
