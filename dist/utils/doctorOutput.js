import { formatOutput } from './formatter.js';
export function resolveDoctorExitCode(result) {
    return result.status === 'DEGRADED' ? 1 : 0;
}
export function printDoctorResult(result, format) {
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
    if (result.layout === 'git-root') {
        // A git root project has no member repository table, so report the hook and
        // the entry points instead — including when the diagnosis stopped before the
        // hook was even reached (rootHook: 'skipped' with no gate issue), where
        // member repository terms would only mislead.
        if (result.rootHook === 'ready') {
            console.log("Worktree bootstrap hook: ready — new git worktrees auto-run 'agentteams init'");
        }
        else if (result.rootHook === 'blocked') {
            console.log("Worktree bootstrap hook: not installed — run 'agentteams init' inside each new worktree");
        }
        else if (result.issues.some((issue) => issue.code === 'post-checkout-hook-no-worktrees')) {
            console.log("Worktree bootstrap hook: skipped — no linked worktree yet; run 'agentteams doctor --install-worktree-hook' to install it now");
        }
        console.log(`Root entry points: ${result.rootEntryPoints.length > 0 ? result.rootEntryPoints.join(', ') : '(none)'}`);
        for (const issue of result.issues) {
            const marker = issue.severity === 'info' ? 'ℹ' : '⚠';
            console.log(`${marker} [${issue.code}] ${issue.message}`);
        }
        return;
    }
    console.log(`Root entry points: ${result.rootEntryPoints.length > 0 ? result.rootEntryPoints.join(', ') : '(none)'}`);
    if (result.missingRecommendedEntryPoints.length > 0) {
        console.log(`Missing recommended entry points: ${result.missingRecommendedEntryPoints.join(', ')}`);
    }
    if (result.repositories.length === 0) {
        console.log('Member repositories: (none found)');
    }
    else {
        console.log('Member repositories:');
        for (const repo of result.repositories) {
            const marker = repo.status === 'READY' ? '✓' : '⚠';
            console.log(`  ${marker} ${repo.path} — ${repo.status} (exclude: ${repo.exclude}, link: ${repo.link}, hook: ${repo.hook}, changes: ${repo.changedCount})`);
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
//# sourceMappingURL=doctorOutput.js.map