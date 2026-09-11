import { Command, Option, CONVENTION_HINT, executeCommand, handleError, printCommandResult } from './shared.js';
import { addOutputOptions } from './options/output.js';
import { formatClaudeCodeSessionStartHook, type SessionSyncResult } from '../commands/session.js';
import { SESSION_HOOK_CLIENT_IDS, SESSION_HOOK_SCOPES } from '../session-hooks/clients.js';

/**
 * 액션 인벤토리: sync, hook install/uninstall. 실사용 옵션: sync는 cwd·hook,
 * hook install/uninstall은 client·scope·yes·dryRun·cwd.
 *
 * `agentteams sync`(사람이 강제로 받는 경로)와 다르다. 이쪽은 세션 시작에 에이전트가 부르는
 * 경로라 **판정을 먼저 하고**, 바뀐 쪽만 받고, 실패해도 정상 종료한다.
 */
export function registerSessionCommand(program: Command): void {
  const root = program
    .command('session')
    .description('Session-scoped operations')
    .addHelpText('after', CONVENTION_HINT);

  const command = addOutputOptions(
    root
      .command('sync')
      .description('Sync conventions and skills for a new session, and report what must be re-read')
      .option('--cwd <path>', 'Working directory (defaults to current)')
      .addOption(
        new Option(
          '--hook <client>',
          'Print a session-start hook payload for the given client instead of the result (ignores --output-file/--verbose)',
        ).choices(['claude-code']),
      ),
  ).addHelpText('after', CONVENTION_HINT);

  command.action(async (options) => {
    const { outputFile, verbose, hook, ...actionOptions } = options;
    const cwd = actionOptions.cwd ?? process.cwd();

    if (hook) {
      await runClaudeCodeHook({ ...actionOptions, cwd });
      return;
    }

    try {
      const result = await executeCommand('session', 'sync', { ...actionOptions, cwd });
      printCommandResult({ result, resource: 'session', action: 'sync', outputFile, verbose });
    } catch (error) {
      // 여기까지 오면 라우팅 자체가 깨진 것이다. `sessionSync`는 동기화 실패를 예외로 올리지
      // 않고 `notes`로 내려보낸다 — 세션 시작이 이 명령 때문에 막히면 안 되기 때문이다.
      console.error(handleError(error));
      process.exit(1);
    }
  });

  const hook = root
    .command('hook')
    .description('Manage the session-start hook that runs `agentteams session sync` automatically')
    .addHelpText('after', CONVENTION_HINT);

  const hookActions = [
    {
      name: 'install',
      description: "Add the AgentTeams session-start hook to a client's settings, keeping every other setting as is",
    },
    {
      name: 'uninstall',
      description: "Remove only the AgentTeams session-start hook from a client's settings (the file itself is kept)",
    },
  ] as const;

  for (const { name, description } of hookActions) {
    addOutputOptions(
      hook
        .command(name)
        .description(description)
        .addOption(
          new Option('--client <id>', 'Target client').choices([...SESSION_HOOK_CLIENT_IDS]).default('claude-code'),
        )
        .addOption(
          new Option('--scope <scope>', 'Configuration scope').choices([...SESSION_HOOK_SCOPES]).default('project'),
        )
        .option('--yes', 'Approve editing the user-level settings file (required for --scope user)', false)
        .option('--dry-run', 'Print the target file and the change without writing anything', false)
        .option(
          '--cwd <path>',
          'Explicit directory for --scope project (defaults to detected project root, or current directory)',
        ),
    )
      .addHelpText('after', CONVENTION_HINT)
      .action(async (options) => {
        const { outputFile, verbose, ...actionOptions } = options;
        try {
          const result = await executeCommand('session', `hook-${name}`, actionOptions);
          printCommandResult({ result, resource: 'session', action: `hook ${name}`, outputFile, verbose });
        } catch (error) {
          console.error(handleError(error));
          process.exit(1);
        }
      });
  }
}

const SESSION_HOOK_DEADLINE_MS = 15_000;

async function runClaudeCodeHook(options: Record<string, unknown>): Promise<void> {
  const timedOut = Symbol('session hook deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      executeCommand('session', 'sync', options) as Promise<SessionSyncResult>,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), SESSION_HOOK_DEADLINE_MS);
      }),
    ]);
    if (result === timedOut) {
      const payload = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            "AgentTeams session sync did not finish at session start — run 'agentteams session sync' manually.",
        },
      });
      // Promise.race만 끝내면 미응답 HTTP 소켓·재시도 타이머가 프로세스를 붙잡는다.
      // 안내를 모두 쓴 뒤 종료하여 Claude Code의 60초 강제 종료보다 먼저 세션을 돌려준다.
      await new Promise<void>((resolve) => {
        process.stdout.write(`${payload}\n`, () => {
          process.exit(0);
          resolve();
        });
      });
      return;
    }
    const payload = formatClaudeCodeSessionStartHook(result);
    // `printCommandResult`를 우회한다. Claude Code가 훅 stdout을 JSON으로 파싱하므로
    // `--output-file` 요약 같은 출력 정책의 텍스트가 한 줄이라도 섞이면 컨텍스트 주입이 깨진다.
    if (payload) process.stdout.write(`${payload}\n`);
  } catch (error) {
    // SessionStart는 비차단이지만 non-zero 종료는 사용자에게 `hook error` 알림을 띄운다.
    // 라우팅 실패로 매 세션 시작을 시끄럽게 만들 이유가 없으니 stderr 한 줄만 남기고 0으로 끝낸다.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`AgentTeams session sync hook failed: ${message.replace(/\s*\n\s*/g, ' ')}\n`);
  } finally {
    clearTimeout(timer);
  }
}
