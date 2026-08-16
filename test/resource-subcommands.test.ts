import { CommanderError, type Command } from 'commander';
import { createProgram } from '../src/program/index.js';
import { executeAttachmentCommand } from '../src/commands/attachment.js';

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

function findAction(resource: string, action: string): Command {
  const program = createProgram('0.0.0');
  const parent = program.commands.find((command) => command.name() === resource);
  const leaf = parent?.commands.find((command) => command.name() === action);
  if (!leaf) throw new Error(`Missing command: ${resource} ${action}`);
  return leaf;
}

const COACTION_ACTION_OPTIONS: Record<string, string> = {
  list: '--page-size',
  get: '--id',
  'takeaway-list': '--page-size',
  'takeaway-create': '--content',
  'takeaway-update': '--takeaway-id',
  'takeaway-delete': '--takeaway-id',
  history: '--page-size',
  create: '--title',
  update: '--plan-id',
  delete: '--id',
  download: '--id',
  cleanup: '--id',
  'link-plan': '--plan-id',
  'unlink-plan': '--plan-id',
  'link-completion-report': '--completion-report-id',
  'unlink-completion-report': '--completion-report-id',
  'link-post-mortem': '--post-mortem-id',
  'unlink-post-mortem': '--post-mortem-id',
};

const DOCUMENT_ACTION_OPTIONS: Record<string, string> = {
  create: '--file',
  update: '--expected-updated-at',
  download: '--id',
  list: '--page-size',
  tags: '--archived',
  delete: '--guide-hash',
  archive: '--id',
  unarchive: '--id',
  revisions: '--page-size',
  'revision-get': '--revision-id',
  'revision-restore': '--revision-id',
  'comment-list': '--order',
  'comment-create': '--content',
  'comment-update': '--comment-id',
  'comment-delete': '--comment-id',
};

describe('coaction/document 액션별 서브커맨드', () => {
  it.each(Object.entries(COACTION_ACTION_OPTIONS))('coaction %s 도움말을 액션 범위로 제한한다', (action, option) => {
    const help = findAction('coaction', action).helpInformation();
    expect(help).toContain(option);
    expect(help).not.toContain('--limit');
  });

  it.each(Object.entries(DOCUMENT_ACTION_OPTIONS))('document %s 도움말을 액션 범위로 제한한다', (action, option) => {
    const help = findAction('document', action).helpInformation();
    expect(help).toContain(option);
    expect(help).not.toContain('--limit');
  });

  it('coaction list의 제거된 limit 별칭을 거부한다', async () => {
    const result = await parse(['coaction', 'list', '--limit', '5']);
    expect(result.error?.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--limit'");
  });
});

const TASK4_ACTION_OPTIONS: Record<string, Record<string, string>> = {
  'code-review': {
    list: '--page-size',
    get: '--finding-id',
    'finding-list': '--page-size',
    create: '--target-ref',
    update: '--diff-file',
    'create-plan': '--finding-ids',
    'submit-result': '--result-summary',
    cancel: '--id',
    delete: '--id',
    dismiss: '--finding-id',
    resolve: '--finding-ids',
    undismiss: '--finding-id',
  },
  comment: {
    list: '--page-size',
    get: '--id',
    create: '--content',
    update: '--expected-updated-at',
    delete: '--guide-hash',
    'reply-list': '--page-size',
    'reply-get': '--reply-id',
    'reply-create': '--content',
    'reply-update': '--expected-updated-at',
    'reply-delete': '--guide-hash',
  },
  'change-set': {
    create: '--title',
    list: '--page-size',
    get: '--id',
    update: '--description',
    delete: '--id',
    'add-item': '--repository-id',
    'remove-item': '--item-id',
  },
  convention: {
    list: '--output-file',
    show: '--output-file',
    download: '--cwd',
    status: '--cwd',
    create: '--scope',
    update: '--apply',
    delete: '--apply',
  },
};

describe('code-review/comment/change-set/convention 액션별 서브커맨드', () => {
  it.each(
    Object.entries(TASK4_ACTION_OPTIONS).flatMap(([resource, actions]) =>
      Object.entries(actions).map(([action, option]) => [resource, action, option] as const),
    ),
  )('%s %s 도움말을 액션 범위로 제한한다', (resource, action, option) => {
    expect(findAction(resource, action).helpInformation()).toContain(option);
  });

  it('comment 서브커맨드 10개를 등록한다', () => {
    const program = createProgram('0.0.0');
    const comment = program.commands.find((command) => command.name() === 'comment');
    expect(comment?.commands.map((command) => command.name())).toHaveLength(10);
    expect(comment?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['reply-list', 'reply-get', 'reply-create', 'reply-update', 'reply-delete']),
    );
  });

  it('제거된 code-review show 별칭을 거부한다', async () => {
    const result = await parse(['code-review', 'show', '--id', 'x']);
    expect(result.error?.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown command 'show'");
  });
});

// 플랫폼 가이드 fenced 예시의 실제 파싱 검증은 guide-command-smoke.test.ts가
// api/src/templates 전체를 대상으로 수행합니다(액션 핸들러를 막고 옵션까지 검증).

describe('나머지 리소스의 액션별 서브커맨드', () => {
  it('report와 postmortem의 숨겨졌던 download 액션을 보존한다', () => {
    expect(findAction('report', 'download').helpInformation()).toContain('--id');
    expect(findAction('postmortem', 'download').helpInformation()).toContain('--id');
  });

  it('report 도움말을 액션별 옵션으로 제한한다', () => {
    expect(findAction('report', 'list').helpInformation()).toContain('--page-size');
    expect(findAction('report', 'list').helpInformation()).not.toContain('--commit-hash');
    expect(findAction('report', 'create').helpInformation()).toContain('--commit-hash');
    expect(findAction('report', 'create').helpInformation()).not.toContain('--page-size');
    expect(findAction('report', 'get').helpInformation()).not.toContain('--title');
  });

  it('auth status의 format과 search의 limit을 보존한다', () => {
    expect(findAction('auth', 'status').helpInformation()).toContain('--format');
    const program = createProgram('0.0.0');
    expect(program.commands.find((command) => command.name() === 'search')?.helpInformation()).toContain('--limit');
  });

  it('attachment upload/delete를 안내 오류용 leaf로 등록한다', () => {
    expect(findAction('attachment', 'upload')).toBeDefined();
    expect(findAction('attachment', 'delete')).toBeDefined();
  });

  it.each(['upload', 'delete'])('attachment %s가 기존 안내 오류를 보존한다', async (action) => {
    await expect(executeAttachmentCommand('https://example.test', {}, action, {})).rejects.toThrow(
      'is not supported by the CLI',
    );
  });
});
