import chalk from 'chalk';
import { formatOutput } from './formatter.js';
import type {
  AgentFileEntry,
  ConfiguredProjectInitResult,
  InitReadinessStep,
  WorktreeInitResult,
} from '../commands/init.js';
import type { EnsurePostCheckoutHookResult } from './conventionLink.js';

export type InitOutputFormat = 'human' | 'json';

interface InitResultShape {
  success: true;
  agentName: string;
  configPath: string;
  conventionPath: string;
  agentFiles?: AgentFileEntry[];
  seedPlanId?: string | null;
  seedPlanWebUrl?: string | null;
  postCheckoutHook?: EnsurePostCheckoutHookResult;
  authMode?: 'api-key' | 'personal-token';
  personalLogin?: { email: string; nickname: string; persisted: boolean; storeBackend?: string };
  warning?: string;
  readiness?: InitReadinessStep[];
}

/** Mirrors AGENT_API_KEY_TTL_MS in api/src/services/agentApiKey.ts. */
const AGENT_API_KEY_TTL_DAYS = 30;

function agentApiKeyExpiryLabel(): string {
  const expiresAt = new Date(Date.now() + AGENT_API_KEY_TTL_DAYS * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString().slice(0, 10);
}

function isInitResult(result: unknown): result is InitResultShape {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return (
    r.success === true &&
    typeof r.agentName === 'string' &&
    typeof r.configPath === 'string' &&
    typeof r.conventionPath === 'string'
  );
}

function isWorktreeInitResult(result: unknown): result is WorktreeInitResult {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return (
    r.success === true &&
    r.mode === 'worktree' &&
    typeof r.worktreePath === 'string' &&
    typeof r.sourcePath === 'string' &&
    typeof r.targetPath === 'string' &&
    (r.materialization === 'symlink' ||
      r.materialization === 'copy' ||
      r.materialization === 'relinked' ||
      r.materialization === 'existing' ||
      r.materialization === 'blocked')
  );
}

function isConfiguredProjectInitResult(result: unknown): result is ConfiguredProjectInitResult {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return (
    r.success === true &&
    r.mode === 'configured-project' &&
    typeof r.configPath === 'string' &&
    typeof r.conventionPath === 'string' &&
    Array.isArray(r.readiness)
  );
}

function printAgentFiles(agentFiles: AgentFileEntry[] | undefined): void {
  for (const file of agentFiles ?? []) {
    if (file.type === 'created') {
      console.log(`✓ Agent file created: ${file.relativePath}`);
    } else if (file.type === 'example') {
      console.log(`✓ Example file created: ${file.relativePath}`);
    } else {
      console.log(`- Agent file already exists, left untouched: ${file.relativePath}`);
    }
  }
}

function printReadiness(readiness: InitReadinessStep[]): void {
  console.log('');
  console.log('Readiness:');
  for (const step of readiness) {
    const line = `  [${step.status}] ${step.stage}`;
    if (step.status === 'DEGRADED') {
      console.warn(line);
      for (const issue of step.issues) {
        console.warn(`    ${issue.message}`);
      }
      console.warn(`    Retry: ${step.retryCommand}`);
    } else {
      console.log(line);
      // Issues print at every status, not just SKIPPED. The `local-adapters`
      // rollup turns READY as soon as one adapter succeeded — and `.gitignore`
      // always does — so a run that created no entry point file and installed no
      // hook still reports READY. Printing only the tag there left the reasons
      // sitting in the JSON payload with nothing on screen.
      for (const issue of step.issues) {
        console.log(`    ${issue.message}`);
      }
    }
  }
}

export function printInitResult(result: unknown, format: InitOutputFormat): void {
  if (format === 'json') {
    console.log(formatOutput(result));
    return;
  }

  if (isWorktreeInitResult(result)) {
    console.log('✓ Detected a linked git worktree.');
    if (result.warning) {
      console.warn(`⚠ ${result.warning}`);
    }
    if (result.materialization === 'blocked') {
      console.warn(`⚠ .agentteams was not created because local exclude is blocked: ${result.targetPath}`);
    } else if (result.materialization === 'existing') {
      console.log(`✓ .agentteams already exists: ${result.targetPath}`);
    } else if (result.materialization === 'relinked') {
      console.log(`✓ Replaced a copied .agentteams with a link to the main checkout: ${result.targetPath}`);
    } else if (result.materialization === 'copy') {
      console.log(`✓ Copied .agentteams into the worktree: ${result.targetPath}`);
    } else {
      console.log(`✓ Linked .agentteams into the worktree: ${result.targetPath}`);
    }
    console.log(`  Source: ${result.sourcePath}`);

    if (Array.isArray(result.entryPoints)) {
      for (const entryPoint of result.entryPoints) {
        if (entryPoint.state === 'created') {
          console.log(`✓ Agent entry point created: ${entryPoint.relativePath}`);
        } else if (entryPoint.state === 'tracked') {
          console.log(`✓ Agent entry point already tracked: ${entryPoint.relativePath}`);
        } else if (entryPoint.state === 'existing') {
          console.log(`✓ Agent entry point already exists: ${entryPoint.relativePath}`);
        } else {
          console.warn(`⚠ Agent entry point skipped: ${entryPoint.relativePath}`);
        }
      }
    }

    if (Array.isArray(result.issues)) {
      for (const issue of result.issues) {
        console.warn(`⚠ ${issue.message}`);
      }
    }

    console.log('  OAuth and interactive prompts were skipped because the main checkout is already configured.');
    return;
  }

  if (isConfiguredProjectInitResult(result)) {
    console.log('✓ Existing project binding reused; browser authentication was skipped.');
    console.log(`✓ Config verified:     ${result.configPath}`);
    if (result.conventionError) {
      console.warn(`⚠ Convention sync is degraded: ${result.conventionError}`);
    } else if (result.conventionsUpdated) {
      console.log('✓ Conventions updated in .agentteams/.');
    } else {
      console.log('✓ Conventions/platform guides already up to date.');
    }
    // A checkmark the readiness list below immediately contradicts reads as
    // "done" to anyone skimming the log, so the mark follows doctor's verdict.
    const doctorStatus = result.doctor?.status;
    if (doctorStatus === 'READY') {
      console.log('✓ Local adapters checked by agentteams doctor.');
    } else if (doctorStatus === 'DEGRADED') {
      console.warn('⚠ Local adapters still need attention (agentteams doctor: DEGRADED).');
    } else if (doctorStatus) {
      console.warn(`⚠ Local adapters were not checked (agentteams doctor: ${doctorStatus}).`);
    }
    // The fast path re-applies the local adapters, so a file it repaired has to
    // be visible here too — otherwise the only proof of the write is on disk.
    printAgentFiles(result.agentFiles);
    printReadiness(result.readiness);
    return;
  }

  if (!isInitResult(result)) {
    console.log(typeof result === 'string' ? result : formatOutput(result));
    return;
  }

  console.log(`✓ Authenticated as ${result.agentName}`);

  // The human view is the default, so anything the personal-token path decided
  // has to show up here — a warning only `--format json` reveals is a warning
  // nobody reads.
  if (result.authMode === 'personal-token') {
    if (result.personalLogin) {
      console.log(`✓ Signed in as ${result.personalLogin.email} (${result.personalLogin.nickname})`);
      // Naming the backend rather than asserting "the OS credential store" is the
      // point: on a remote box the login may well be in a permission-protected
      // file, and telling the user it is in the keyring would be false in exactly
      // the case where the difference matters.
      if (!result.personalLogin.persisted) {
        console.log('⚠ Login kept in memory for this process only.');
      } else if (result.personalLogin.storeBackend === 'protected-file') {
        console.log(
          '✓ Login stored in a file only your account can read (~/.agentteams/credentials); no long-lived key was written to this repository.',
        );
        console.log(
          "  This machine's OS credential store was unavailable. File permissions are weaker than the OS keyring — run 'agentteams auth status' for details.",
        );
      } else {
        console.log('✓ Login stored in the OS credential store; no long-lived key was written to this repository.');
      }
    }
    // 이 경로는 setup용 agent key를 애초에 발급하지 않는다. "발급했다가 폐기했다"는
    // 이전 안내 줄은 그래서 사라졌다.
    console.log('✓ No agent API key was created for this setup.');
  }

  // The compatibility path has a hard 30-day server-side TTL and no renewal of its own.
  // Saying so here is the difference between a planned reissue and a runner that starts
  // failing with a bare 401 exactly one month from today.
  if (result.authMode === 'api-key') {
    console.log(`⚠ This agent API key expires in 30 days (${agentApiKeyExpiryLabel()}) and does not renew itself.`);
    console.log(
      "  Reissue it in the web app (project settings → agents) before then, or run 'agentteams init' to switch to a personal login that refreshes automatically.",
    );
  }

  if (result.warning) {
    console.warn(`⚠ ${result.warning}`);
  }

  console.log(`✓ Config saved:      ${result.configPath}`);
  console.log(`✓ Convention saved:  ${result.conventionPath}`);
  console.log(`✓ Conventions synced to .agentteams/`);

  if (result.readiness) {
    printReadiness(result.readiness);
  }

  const hook = result.postCheckoutHook;
  if (hook) {
    if (hook.status === 'ready') {
      console.log(`✓ Worktree bootstrap hook installed: new git worktrees auto-run 'agentteams init'`);
    } else {
      console.warn(`⚠ Worktree bootstrap hook not installed: ${hook.issue?.message ?? 'unknown reason'}`);
      console.warn(`  New worktrees will need 'agentteams init' run manually.`);
    }
  }

  printAgentFiles(result.agentFiles);

  console.log('');
  console.log('Next steps:');

  // Pointing at "the generated agent files" when the run generated none sent
  // users looking for a CLAUDE.md that was never written. The readiness list
  // above already says why it was skipped; this line offers the way to get one.
  const writtenAgentFiles = (result.agentFiles ?? []).filter((file) => file.type !== 'skipped');
  if (writtenAgentFiles.length > 0) {
    console.log(`  1. Check the generated agent files (${writtenAgentFiles.map((f) => f.relativePath).join(', ')})`);
    console.log('     If a -example file was created, merge it into your existing file.');
  } else {
    console.log('  1. No agent entry point file was created in this run.');
    console.log(
      "     Create one with 'agentteams init --agent-files CLAUDE.md' so agents load .agentteams/convention.md.",
    );
  }

  if (result.seedPlanId) {
    const seedPlanDisplayId = `agentteams_pln_${result.seedPlanId}`;
    console.log('  2. A "Set Up Project Conventions" plan is queued for this project.');
    console.log(`     Plan ID:  ${chalk.bold(seedPlanDisplayId)}`);
    if (result.seedPlanWebUrl) {
      console.log(`     Open:     ${result.seedPlanWebUrl}`);
    }
    console.log('     Copy & paste to your AI agent:');
    console.log(chalk.cyan(`       Start plan ${seedPlanDisplayId} and create conventions for this project.`));
  } else {
    console.log('  2. Set up conventions for your project by saying to your AI agent:');
    console.log(
      chalk.cyan('       Read .agentteams/platform/convention-setup-guide.md and create conventions for this project.'),
    );
  }

  console.log('  3. Or try other commands:');
  console.log(chalk.cyan('       Create a plan to improve test coverage for this project.'));
}
