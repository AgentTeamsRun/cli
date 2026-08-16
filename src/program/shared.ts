import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command, Option } from 'commander';
import { executeCommand } from '../commands/index.js';
import type { DoctorResult } from '../commands/doctor.js';
import { formatAuthResultText } from '../utils/authFormat.js';
import { resolveApiKeyInput } from '../utils/apiKeyInput.js';
import { printDoctorResult, resolveDoctorExitCode } from '../utils/doctorOutput.js';
import { handleError } from '../utils/errors.js';
import { formatOutput } from '../utils/formatter.js';
import { printInitResult } from '../utils/initOutput.js';
import { executeValidatedInteractiveCommand, normalizeInteractiveFormat } from '../utils/interactiveCommand.js';
import { createSummaryLines, type OutputFormat } from '../utils/outputPolicy.js';
import { MCP_CLIENT_IDS } from '../mcp-registration/types.js';

export {
  Command,
  Option,
  executeCommand,
  executeValidatedInteractiveCommand,
  formatAuthResultText,
  formatOutput,
  handleError,
  MCP_CLIENT_IDS,
  normalizeInteractiveFormat,
  printDoctorResult,
  printInitResult,
  resolveDoctorExitCode,
};
export type { DoctorResult, OutputFormat };

export function createApiKeyFileOption(): Option {
  return new Option('--api-key-file <path>', 'Read the API key from a file, or use "-" to read stdin.');
}

export function registerApiKeyHook(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    try {
      const commands: Command[] = [];
      for (let command: Command | null = actionCommand; command; command = command.parent) {
        commands.push(command);
      }

      const apiKeyFileCommand = commands.find((command) => command.opts().apiKeyFile !== undefined);
      if (!apiKeyFileCommand) return;

      const apiKeyFile = apiKeyFileCommand?.opts().apiKeyFile as string | undefined;
      const resolvedApiKey = resolveApiKeyInput({ apiKeyFile });
      apiKeyFileCommand.setOptionValue('apiKey', resolvedApiKey);
    } catch (error) {
      console.error(handleError(error));
      process.exit(1);
    }
  });
}

/**
 * 제거된 공개 인자는 commander가 `unknown option '--format'`으로만 끝냅니다.
 * 각 프로젝트에 이미 배포된 `.agentteams/convention.md` 사본이나 기존 CI 스크립트는
 * 갱신 경로 없이 그대로 깨지므로, 오류 뒤에 대체 수단을 한 줄 덧붙입니다.
 */
const PLAN_HTML_PREVIEW_HINT =
  'Plan HTML previews were removed. Plans render their content directly in the web UI — drop the HTML flags and send the plan body with --content or --file.';

const REMOVED_OPTION_HINTS: Record<string, string> = {
  '--format':
    '--format only exists on init, auth, sync, and doctor. Every other command already prints JSON; use --verbose for the full payload when --output-file is set.',
  '--api-key': '--api-key was removed. Use --api-key-file <path> or set the AGENTTEAMS_API_KEY environment variable.',
  '--team-id':
    '--team-id was removed. Set the AGENTTEAMS_TEAM_ID environment variable or the teamId field in your CLI config.',
  '--limit': '--limit was removed from list actions. Use --page-size.',
  '--html-file': PLAN_HTML_PREVIEW_HINT,
  '--html-stdin': PLAN_HTML_PREVIEW_HINT,
  '--source-label': PLAN_HTML_PREVIEW_HINT,
};

const REMOVED_COMMAND_HINTS: Record<string, string> = {
  show: "The 'show' alias was removed. Use 'get'.",
  'upload-html': PLAN_HTML_PREVIEW_HINT,
};

export function removedContractHint(text: string): string | undefined {
  const option = /unknown option '(--[\w-]+)'/.exec(text)?.[1];
  if (option && REMOVED_OPTION_HINTS[option]) return REMOVED_OPTION_HINTS[option];

  const command = /unknown command '([\w-]+)'/.exec(text)?.[1];
  if (command && REMOVED_COMMAND_HINTS[command]) return REMOVED_COMMAND_HINTS[command];

  return undefined;
}

export function normalizeFormat(format: unknown): OutputFormat {
  if (format === undefined || format === null || format === '') return 'json';
  if (format === 'json') return 'json';
  throw new Error(`Unsupported output format: ${String(format)}. Only json is supported.`);
}

function writeOutputFile(outputFile: string, content: string): { resolvedPath: string; bytes: number } {
  const resolvedPath = resolve(outputFile);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  return { resolvedPath, bytes };
}

/**
 * 출력 정책: 기본은 전체 결과, `--output-file`이 있으면 저장 경로 + 요약,
 * 거기에 `--verbose`까지 있으면 요약 뒤에 전체 결과를 덧붙입니다.
 */
export function printCommandResult(params: {
  result: unknown;
  outputFile?: string;
  verbose?: boolean;
  resource?: string;
  action?: string;
}): void {
  const outputText = typeof params.result === 'string' ? params.result : formatOutput(params.result);

  if (typeof params.outputFile === 'string' && params.outputFile.trim().length > 0) {
    const { resolvedPath, bytes } = writeOutputFile(params.outputFile, outputText);
    console.log(`Saved output to ${resolvedPath} (${bytes} bytes).`);
    for (const line of createSummaryLines(params.result, { resource: params.resource, action: params.action })) {
      console.log(line);
    }
    if (params.verbose) console.log(outputText);
    return;
  }

  console.log(outputText);
}

export const DEVICE_AUTH_OPTION_DESCRIPTION =
  'authorize with a short code on another device instead of a local browser callback (for SSH, containers, and other headless shells)';
export const DEVICE_AUTH_SET_DEFAULT_DESCRIPTION =
  "with --device-auth: remember device-code login as this machine's default in ~/.agentteams/config.json";
export const CONVENTION_HINT = '\nFor workflow rules and reporting guidelines, see: .agentteams/convention.md';
