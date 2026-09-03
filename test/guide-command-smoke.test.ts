import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { createProgram } from '../src/program/index.js';

const repoRoot = new URL('../../', import.meta.url);

/**
 * 스캔 대상: 서버가 배포하는 컨벤션 템플릿과, 사용자·에이전트가 읽는 공개 문서.
 * 여기 있는 예시가 실제 CLI 파서를 통과하지 못하면 계약이 깨진 것입니다.
 */
const SCAN_ROOTS = ['api/src/templates/', 'docs/content/', 'cli/README.md', 'cli/API-CLI-WORKFLOW.md'];

const MARKDOWN_EXTENSIONS = ['.md', '.mdx'];

/**
 * 필수 인자가 플레이스홀더로 생략된 예시는 옵션 검증 대상이 아니라 서술용 스니펫입니다.
 * 값이 빠진 옵션이나 구조 플레이스홀더는 아래 isSyntaxSketch()가 걸러냅니다.
 */
const SKIPPED_EXAMPLES = new Set<string>(['agentteams resolve', 'agentteams mcp install --client']);

/** 커맨드/액션 자리 자체가 플레이스홀더이거나 `a|b`로 대안을 나열한 문법 설명 줄. */
const SYNTAX_PLACEHOLDERS = ['<command>', '<action>', '<subcommand>'];
function isSyntaxSketch(command: string): boolean {
  if (SYNTAX_PLACEHOLDERS.some((placeholder) => command.includes(placeholder))) return true;
  return commandArgs(command).some((token) => !token.startsWith('-') && token.includes('|'));
}

function markdownFiles(target: URL): URL[] {
  if (!statSync(target).isDirectory()) return [target];
  const directory = target.href.endsWith('/') ? target : new URL(`${target.href}/`);
  return readdirSync(directory).flatMap((name) => {
    const url = new URL(name, directory);
    if (statSync(url).isDirectory()) return markdownFiles(new URL(`${url.href}/`));
    return MARKDOWN_EXTENSIONS.some((extension) => name.endsWith(extension)) ? [url] : [];
  });
}

function extractCommands(): string[] {
  return SCAN_ROOTS.flatMap((root) => markdownFiles(new URL(root, repoRoot))).flatMap((file) => {
    const markdown = readFileSync(file, 'utf8');
    const fenced: string[] = [];
    let inFence = false;
    let pending = '';
    for (const rawLine of markdown.split('\n')) {
      if (/^\s*`{3,}/.test(rawLine)) {
        if (pending) fenced.push(pending.trim());
        pending = '';
        inFence = !inFence;
        continue;
      }
      if (!inFence) continue;
      const line = rawLine.trim();
      if (pending) {
        pending += ` ${line.replace(/\\$/, '')}`;
        if (!line.endsWith('\\')) {
          fenced.push(pending.trim());
          pending = '';
        }
      } else if (line.startsWith('agentteams ')) {
        pending = line.replace(/\\$/, '');
        if (!line.endsWith('\\')) {
          fenced.push(pending.trim());
          pending = '';
        }
      }
    }

    const inline = [...markdown.matchAll(/`(agentteams [^`\n]+)`/g)]
      .map((match) => match[1])
      .filter((command) => !command.includes('<command>') && !/\b\w+\/\w+/.test(command));
    return [...fenced, ...inline];
  });
}

function commandArgs(command: string): string[] {
  const beforeShellOperator = command.split(/\s(?:&&|\|\||\||>|2>)\s?/)[0].replace(/\s+#.*$/, '');
  const tokens = beforeShellOperator.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.slice(1).map((token) =>
    token
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .replace(/^['"]|['"]$/g, ''),
  );
}

/**
 * `--api-key-file`은 파싱 전 preAction 훅에서 실제로 파일을 읽고, 실패하면
 * process.exit(1)으로 테스트 러너까지 죽입니다. 예시의 플레이스홀더 경로를
 * 읽을 수 있는 고정 파일로 바꿔 파서 검증만 남깁니다.
 */
let apiKeyFixture: string | undefined;
function apiKeyFixturePath(): string {
  if (!apiKeyFixture) {
    apiKeyFixture = join(mkdtempSync(join(tmpdir(), 'agentteams-guide-smoke-')), 'api-key');
    writeFileSync(apiKeyFixture, 'key_guide_smoke_fixture\n', 'utf-8');
  }
  return apiKeyFixture;
}

function withReadableApiKeyFile(args: string[]): string[] {
  return args.map((arg, index) => (args[index - 1] === '--api-key-file' ? apiKeyFixturePath() : arg));
}

function configureForParse(command: Command, output: { stdout: string; stderr: string }): void {
  command.configureOutput({ writeOut: (text) => (output.stdout += text), writeErr: (text) => (output.stderr += text) });
  command.exitOverride();
  for (const child of command.commands) configureForParse(child, output);
}

/** 액션 핸들러 직전에 던져, 인자 검증만 끝내고 실제 API 호출은 막습니다. */
class ReachedAction extends Error {}

type ParseOutcome = { ok: boolean; code?: string; stderr: string };

async function parseExample(args: string[]): Promise<ParseOutcome> {
  const program = createProgram('0.0.0');
  const output = { stdout: '', stderr: '' };
  configureForParse(program, output);
  program.hook('preAction', () => {
    throw new ReachedAction();
  });

  try {
    await program.parseAsync(['node', 'agentteams', ...withReadableApiKeyFile(args)], { from: 'node' });
    return { ok: true, stderr: output.stderr };
  } catch (error) {
    if (error instanceof ReachedAction) return { ok: true, stderr: output.stderr };
    if (!(error instanceof CommanderError)) throw error;
    // helpDisplayed/version은 예시가 의도적으로 도움말을 부르는 경우입니다.
    const ok = error.code === 'commander.helpDisplayed' || error.code === 'commander.version';
    return { ok, code: error.code, stderr: output.stderr };
  }
}

describe('배포 가이드·공개 문서 CLI 예시', () => {
  const commands = extractCommands().filter(
    (command) => !SKIPPED_EXAMPLES.has(command.trim()) && !isSyntaxSketch(command),
  );

  it('스캔 대상 전체에서 100개 이상의 명령을 추출한다', () => {
    console.info(`[guide-command-smoke] extracted=${commands.length}`);
    expect(commands.length).toBeGreaterThanOrEqual(100);
  });

  it.each(commands)('%s', async (command) => {
    const result = await parseExample(commandArgs(command));
    expect({ command, ok: result.ok, code: result.code, stderr: result.stderr.trim() }).toMatchObject({ ok: true });
  });
});

describe('제거된 계약을 실제로 거부한다', () => {
  it.each([
    [['search', '--query', 'x', '--format', 'json'], 'commander.unknownOption'],
    [['plan', 'get', '--id', 'x', '--format', 'json'], 'commander.unknownOption'],
    [['plan', 'list', '--limit', '5'], 'commander.unknownOption'],
    [['report', 'list', '--api-key', 'x'], 'commander.unknownOption'],
    [['plan', 'list', '--team-id', 'x'], 'commander.unknownOption'],
    [['plan', 'show', '--id', 'x'], 'commander.unknownCommand'],
    [['code-review', 'show', '--id', 'x'], 'commander.unknownCommand'],
    [['task', 'show', '--plan-id', 'x'], 'commander.unknownCommand'],
  ])('%s → %s', async (args, code) => {
    const result = await parseExample(args as string[]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(code);
  });
});

describe('액션별 도움말 크기와 오류 승격', () => {
  const limits: Array<[string[], number]> = [
    [['plan', 'get'], 660],
    [['plan', 'create'], 2400],
    [['report', 'create'], 2500],
    [['code-review', 'create'], 3000],
    [['comment', 'reply-create'], 1300],
    [['document', 'create'], 1900],
    [['linear', 'issue', 'create'], 1600],
  ];

  it.each(limits)('%s 도움말은 %i바이트 이하이다', async (args, limit) => {
    const program = createProgram('0.0.0');
    const output = { stdout: '', stderr: '' };
    configureForParse(program, output);
    try {
      await program.parseAsync(['node', 'agentteams', ...args, '--help'], { from: 'node' });
    } catch (error) {
      if (!(error instanceof CommanderError) || error.code !== 'commander.helpDisplayed') throw error;
    }
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(limit);
  });

  it.each([
    [['plan', 'list', '--html-file', 'x']],
    [['report', 'get', '--title', 'x']],
    [['comment', 'reply-get', '--content', 'x']],
  ])('무관한 플래그를 거부한다: %s', async (args) => {
    const program = createProgram('0.0.0');
    configureForParse(program, { stdout: '', stderr: '' });
    await expect(program.parseAsync(['node', 'agentteams', ...args], { from: 'node' })).rejects.toMatchObject({
      code: 'commander.unknownOption',
    });
  });
});
