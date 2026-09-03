import { createHash } from 'node:crypto';
import { CommanderError } from 'commander';
import { createProgram } from '../src/program/index.js';
import { CANONICAL_CLI_NAME } from '../src/program/invokedName.js';

const BASELINE_HELP_SHA256: Record<string, string> = {
  init: '88a2ccc61b94be265bb63210c6c8019cb221153a4d5686c48aed5da56c9060f8',
  doctor: 'c8ccb727d8d02ba300d5077419ddccfb626713d266f8b8f85f7bbd03920c86ed',
  sync: 'c2089a5d0545ce3180759be24509a384676edde8109940e3ac38e9a3f1c57905',
};

async function renderHelp(commandName: string): Promise<string> {
  // 서브커맨드 usage 첫 줄에 부모 프로그램명이 들어가므로, baseline이 실행 진입점(process.argv[1])에
  // 좌우되지 않도록 정식 이름을 명시 고정한다.
  const program = createProgram('0.0.0', CANONICAL_CLI_NAME);
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

async function renderNestedHelp(resource: string, action: string): Promise<string> {
  const program = createProgram('0.0.0', CANONICAL_CLI_NAME);
  let output = '';
  program.configureOutput({ writeOut: (text) => (output += text) });
  const configureExitOverride = (command: typeof program): void => {
    command.exitOverride();
    for (const subcommand of command.commands) configureExitOverride(subcommand);
  };
  configureExitOverride(program);

  try {
    await program.parseAsync(['node', 'agentteams', resource, action, '--help'], { from: 'node' });
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== 'commander.helpDisplayed') throw error;
  }

  return output.replace(/\s+/g, ' ');
}

describe('커맨드 등록 모듈 분할', () => {
  it.each(Object.entries(BASELINE_HELP_SHA256))('%s 도움말을 바이트 단위로 보존한다', async (name, expected) => {
    const output = await renderHelp(name);
    expect(createHash('sha256').update(output).digest('hex')).toBe(expected);
  });

  // 옵트인 플래그는 도움말에 보이지 않으면 존재하지 않는 것과 같다.
  // commander가 설명을 줄바꿈으로 감싸므로 공백을 정규화한 뒤 문구를 확인한다.
  it('init 도움말이 --mcp 옵트인을 영어 설명과 함께 노출한다', async () => {
    const output = (await renderHelp('init')).replace(/\s+/g, ' ');
    expect(output).toContain('--mcp');
    expect(output).toContain('Register AgentTeams with the MCP clients detected in this folder (project scope)');
    expect(output).toContain('Without this flag no client configuration is written');
  });

  // 엔트리포인트 프롬프트가 옵트인이 된 뒤로, 감지 결과를 손으로 뒤집는 유일한 대안 경로가
  // 이 플래그다. 도움말에서 사라지면 사용자는 그런 선택지가 있는 줄도 모른다.
  it('init 도움말이 --interactive 옵트인을 영어 설명과 함께 노출한다', async () => {
    const output = (await renderHelp('init')).replace(/\s+/g, ' ');
    expect(output).toContain('--interactive');
    expect(output).toContain(
      'Choose the agent entry point files from a prompt instead of using the AI clients detected in this folder',
    );
    expect(output).toContain('Without this flag init asks nothing');
  });

  it('code-review create 도움말이 총평 텍스트·파일 옵션과 우선순위를 노출한다', async () => {
    const output = await renderNestedHelp('code-review', 'create');
    expect(output).toContain('--result-summary <text>');
    expect(output).toContain('--result-summary-file <path>');
    expect(output).toContain('takes precedence over --result-summary-file');
  });

  it('code-review submit-result 도움말이 총평 파일 옵션과 텍스트 우선순위를 노출한다', async () => {
    const output = await renderNestedHelp('code-review', 'submit-result');
    expect(output).toContain('--result-summary-file <path>');
    expect(output).toContain('takes precedence over --result-summary-file');
  });
});
