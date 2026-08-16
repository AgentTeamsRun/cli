import { CommanderError, type Command } from 'commander';
import { createProgram } from '../src/program/index.js';

function configureForTest(program: Command, output: { stdout: string; stderr: string }): void {
  program.configureOutput({
    writeOut: (text) => (output.stdout += text),
    writeErr: (text) => (output.stderr += text),
  });
  program.exitOverride();
  for (const command of program.commands) configureForTest(command, output);
}

async function parse(args: string[]): Promise<{ error?: CommanderError; stdout: string; stderr: string }> {
  const program = createProgram('0.0.0');
  const output = { stdout: '', stderr: '' };
  configureForTest(program, output);

  try {
    await program.parseAsync(['node', 'agentteams', ...args], { from: 'node' });
    return output;
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return { ...output, error };
  }
}

describe('plan 액션별 서브커맨드', () => {
  it('get 도움말을 660바이트 이하로 유지한다', async () => {
    const result = await parse(['plan', 'get', '--help']);
    expect(result.error?.code).toBe('commander.helpDisplayed');
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(660);
  });

  it('list와 무관한 html-file 옵션을 거부한다', async () => {
    const result = await parse(['plan', 'list', '--page-size', '1', '--html-file', '/nonexistent']);
    expect(result.error?.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--html-file'");
  });

  it.each([['create'], ['update'], ['quick']] as const)(
    'plan %s --help에 HTML 프리뷰 플래그가 없다',
    async (action) => {
      const result = await parse(['plan', action, '--help']);
      expect(result.stdout).not.toContain('--html-file');
      expect(result.stdout).not.toContain('--html-stdin');
      expect(result.stdout).not.toContain('--source-label');
    },
  );

  it.each([['create'], ['update'], ['quick']] as const)(
    'plan %s는 --html-file을 unknown option으로 거부한다',
    async (action) => {
      const result = await parse(['plan', action, '--html-file', 'x.html']);
      expect(result.error?.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown option '--html-file'");
    },
  );

  it('제거된 upload-html 커맨드를 거부한다', async () => {
    const result = await parse(['plan', 'upload-html', '--id', 'plan-1', '--file', 'x.html']);
    expect(result.error?.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown command 'upload-html'");
  });

  it('제거된 show 별칭을 거부한다', async () => {
    const result = await parse(['plan', 'show', '--id', 'plan-1']);
    expect(result.error?.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown command 'show'");
  });

  // 러너는 CLI와 따로 배포되므로 구 러너의 `plan issue` 호출을 한 릴리스 동안 흡수합니다.
  it('issue를 link-issue의 숨은 별칭으로 유지한다', () => {
    const program = createProgram('0.0.0');
    const plan = program.commands.find((command) => command.name() === 'plan');
    const linkIssue = plan?.commands.find((command) => command.name() === 'link-issue');
    expect(linkIssue?.aliases()).toContain('issue');
    expect(plan?.commands.some((command) => command.name() === 'issue')).toBe(false);
  });

  it('plan issue를 link-issue 액션으로 디스패치한다', async () => {
    const program = createProgram('0.0.0');
    configureForTest(program, { stdout: '', stderr: '' });
    const dispatched: string[] = [];
    program.hook('preAction', (_parent, actionCommand) => {
      dispatched.push(actionCommand.name());
      throw new CommanderError(0, 'test.reachedAction', 'reached action');
    });

    await expect(
      program.parseAsync(
        ['node', 'agentteams', 'plan', 'issue', '--id', 'plan-1', '--provider', 'GITHUB', '--external-id', '1'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ code: 'test.reachedAction' });
    expect(dispatched).toEqual(['link-issue']);
  });
});

// 배포 가이드 fenced 예시의 실제 파싱 검증은 guide-command-smoke.test.ts가
// api/src/templates 전체를 대상으로 수행합니다(액션 핸들러를 막고 옵션까지 검증).
