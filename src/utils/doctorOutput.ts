import { formatOutput } from './formatter.js';
import type { DoctorResult } from '../commands/doctor.js';

export type DoctorOutputFormat = 'human' | 'json';

export function resolveDoctorExitCode(result: DoctorResult): 0 | 1 {
  return result.status === 'DEGRADED' ? 1 : 0;
}

export function printDoctorResult(result: DoctorResult, format: DoctorOutputFormat): void {
  if (format === 'json') {
    // The JSON view must stay a single parseable document on stdout.
    console.log(formatOutput(result));
    return;
  }

  console.log(`Status: ${result.status}`);
  if (result.rootDir) {
    console.log(`Convention root: ${result.rootDir}`);
  }

  if (!result.applicable) {
    for (const issue of result.issues) {
      console.log(`  [${issue.code}] ${issue.message}`);
    }
    return;
  }

  console.log(`Changes applied: ${result.changedCount}`);
  console.log(`Root entry points: ${result.rootEntryPoints.length > 0 ? result.rootEntryPoints.join(', ') : '(none)'}`);
  if (result.missingRecommendedEntryPoints.length > 0) {
    console.log(`Missing recommended entry points: ${result.missingRecommendedEntryPoints.join(', ')}`);
  }

  if (result.repositories.length === 0) {
    console.log('Member repositories: (none found)');
  } else {
    console.log('Member repositories:');
    for (const repo of result.repositories) {
      const marker = repo.status === 'READY' ? '✓' : '⚠';
      console.log(
        `  ${marker} ${repo.path} — ${repo.status} (exclude: ${repo.exclude}, link: ${repo.link}, hook: ${repo.hook}, changes: ${repo.changedCount})`,
      );
      for (const conflict of repo.entryPointConflicts) {
        console.log(`      conflict: ${conflict.relativePath} (${conflict.state})`);
      }
      for (const issue of repo.issues) {
        console.log(`      [${issue.code}] ${issue.message}`);
      }
    }
  }

  for (const issue of result.issues) {
    const marker = issue.severity === 'info' ? 'ℹ' : '⚠';
    console.log(`${marker} [${issue.code}] ${issue.message}`);
  }
}
