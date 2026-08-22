import { Command, Option } from 'commander';
import { executeCommand } from '../commands/index.js';
import type { DoctorResult } from '../commands/doctor.js';
import { formatAuthResultText } from '../utils/authFormat.js';
import { printDoctorResult, resolveDoctorExitCode } from '../utils/doctorOutput.js';
import { handleError } from '../utils/errors.js';
import { formatOutput } from '../utils/formatter.js';
import { printInitResult } from '../utils/initOutput.js';
import { executeValidatedInteractiveCommand, normalizeInteractiveFormat } from '../utils/interactiveCommand.js';
import { type OutputFormat } from '../utils/outputPolicy.js';
import { MCP_CLIENT_IDS } from '../mcp-registration/types.js';
export { Command, Option, executeCommand, executeValidatedInteractiveCommand, formatAuthResultText, formatOutput, handleError, MCP_CLIENT_IDS, normalizeInteractiveFormat, printDoctorResult, printInitResult, resolveDoctorExitCode, };
export type { DoctorResult, OutputFormat };
export declare function createApiKeyFileOption(): Option;
export declare function registerApiKeyHook(program: Command): void;
export declare function removedContractHint(text: string): string | undefined;
export declare function normalizeFormat(format: unknown): OutputFormat;
/**
 * 출력 정책: 기본은 전체 결과, `--output-file`이 있으면 저장 경로 + 요약,
 * 거기에 `--verbose`까지 있으면 요약 뒤에 전체 결과를 덧붙입니다.
 */
export declare function printCommandResult(params: {
    result: unknown;
    outputFile?: string;
    verbose?: boolean;
    resource?: string;
    action?: string;
}): void;
export declare const DEVICE_AUTH_OPTION_DESCRIPTION = "authorize with a short code on another device instead of a local browser callback (for SSH, containers, and other headless shells)";
export declare const DEVICE_AUTH_SET_DEFAULT_DESCRIPTION = "with --device-auth: remember device-code login as this machine's default in ~/.agentteams/config.json";
export declare const CONVENTION_HINT = "\nFor workflow rules and reporting guidelines, see: .agentteams/convention.md";
//# sourceMappingURL=shared.d.ts.map