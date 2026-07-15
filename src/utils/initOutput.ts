import chalk from 'chalk';
import { formatOutput } from './formatter.js';
import type { AgentFileEntry, WorktreeInitResult } from '../commands/init.js';

export type InitOutputFormat = 'human' | 'json';

interface InitResultShape {
  success: true;
  agentName: string;
  configPath: string;
  conventionPath: string;
  agentFiles?: AgentFileEntry[];
  seedPlanId?: string | null;
  seedPlanWebUrl?: string | null;
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
    (r.materialization === 'symlink' || r.materialization === 'copy' || r.materialization === 'existing')
  );
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
    if (result.materialization === 'existing') {
      console.log(`✓ .agentteams already exists: ${result.targetPath}`);
    } else if (result.materialization === 'copy') {
      console.log(`✓ Copied .agentteams into the worktree: ${result.targetPath}`);
    } else {
      console.log(`✓ Linked .agentteams into the worktree: ${result.targetPath}`);
    }
    console.log(`  Source: ${result.sourcePath}`);
    console.log('  OAuth and interactive prompts were skipped because the main checkout is already configured.');
    return;
  }

  if (!isInitResult(result)) {
    console.log(typeof result === 'string' ? result : formatOutput(result));
    return;
  }

  console.log(`✓ Authenticated as ${result.agentName}`);
  console.log(`✓ Config saved:      ${result.configPath}`);
  console.log(`✓ Convention saved:  ${result.conventionPath}`);
  console.log(`✓ Conventions synced to .agentteams/`);

  if (result.agentFiles && result.agentFiles.length > 0) {
    for (const file of result.agentFiles) {
      if (file.type === 'created') {
        console.log(`✓ Agent file created: ${file.relativePath}`);
      } else {
        console.log(`✓ Example file created: ${file.relativePath}`);
      }
    }
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Check the generated agent files (CLAUDE.md, AGENTS.md, etc.)');
  console.log('     If a -example file was created, merge it into your existing file.');

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
