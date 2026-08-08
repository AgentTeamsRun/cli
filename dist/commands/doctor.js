import { chmodSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE_MODE, findProjectConfig } from '../utils/config.js';
import { BACKUP_SUFFIX } from '../mcp-registration/atomicWrite.js';
import { findMemberRepos, isNonGitRootProject } from '../utils/projectLayout.js';
import { ensureConventionEntryPoints, ensureConventionLink, ensureLocalExclude, ensurePostCheckoutHook, inspectConventionLink, isReadableRegularFile, toAnchoredExcludePattern, } from '../utils/conventionLink.js';
import { withCommandContext } from '../utils/commandContext.js';
import { shouldInstallWorktreeHook } from '../utils/git.js';
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const CONVENTION_FILE = 'convention.md';
// Mirrors AGENT_ENTRY_POINT_FILES in commands/init.ts — the doctor only reads
// which of these exist at the convention root; it never creates root files.
const ENTRY_POINT_ALLOWLIST = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursor/rules/agentteams.mdc'];
const RECOMMENDED_ENTRY_POINTS = ['CLAUDE.md', 'AGENTS.md'];
// Hook installation blocked by the user's own hook setup, not by a defect the
// doctor can or should repair.
const USER_HOOK_CONFIG_CODES = new Set(['hook-hookspath', 'hook-custom']);
function pathEntryExists(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * `.agentteams/config.json` holds a long-lived API key. `saveConfig` writes new
 * ones owner-only, but a config written before that, restored from a backup, or
 * copied around by hand can still be group- or world-readable — and narrowing it
 * is an explicit, user-invoked repair, never a side effect of an unrelated save.
 */
function repairConfigFilePermissions(rootDir) {
    // Windows has no POSIX mode bits; chmod there only toggles the read-only flag.
    if (process.platform === 'win32') {
        return { changedCount: 0, issues: [] };
    }
    const issues = [];
    let changedCount = 0;
    const candidates = [
        join(rootDir, CONFIG_DIR, CONFIG_FILE),
        // A predictable path holding a full copy of the same secret.
        join(rootDir, CONFIG_DIR, `${CONFIG_FILE}${BACKUP_SUFFIX}`),
    ];
    for (const path of candidates) {
        let mode;
        try {
            const stats = lstatSync(path);
            if (!stats.isFile())
                continue;
            mode = stats.mode & 0o777;
        }
        catch {
            continue;
        }
        // Only group/other access matters here; the owner's own bits are not exposure.
        if ((mode & 0o077) === 0)
            continue;
        const reported = `0${mode.toString(8).padStart(3, '0')}`;
        try {
            chmodSync(path, CONFIG_FILE_MODE);
            changedCount += 1;
            issues.push({
                code: 'config-permissions-narrowed',
                path,
                message: `${path} was readable beyond its owner (${reported}); narrowed it to 0600. Reissue the agent API key if the machine is shared.`,
                severity: 'info',
            });
        }
        catch (error) {
            issues.push({
                code: 'config-permissions-unrepairable',
                path,
                message: `${path} is readable beyond its owner (${reported}) and could not be narrowed to 0600: ${error instanceof Error ? error.message : String(error)}`,
                severity: 'error',
            });
        }
    }
    return { changedCount, issues };
}
function withConfigPermissionFindings(result, repair) {
    if (repair.changedCount === 0 && repair.issues.length === 0) {
        return result;
    }
    const degraded = result.status === 'DEGRADED' || repair.issues.some((issue) => issue.severity === 'error');
    return {
        ...result,
        status: degraded ? 'DEGRADED' : result.status,
        changedCount: result.changedCount + repair.changedCount,
        issues: [...result.issues, ...repair.issues],
    };
}
function notApplicableResult(rootDir, issue) {
    return {
        status: 'NOT_APPLICABLE',
        layout: 'unknown',
        applicable: false,
        changedCount: 0,
        rootDir,
        rootEntryPoints: [],
        missingRecommendedEntryPoints: [],
        repositories: [],
        rootHook: 'skipped',
        issues: [issue],
    };
}
/**
 * Which agent entry points exist at the convention root.
 *
 * `missingSeverity` differs by layout on purpose. A non-git-root project mirrors
 * these files into every member repo, so a missing one breaks the layout the
 * doctor manages — that is an error. A git root project only needs *some* path
 * from an agent to `.agentteams/convention.md`; calling a repository that uses
 * one client but not the other broken would turn `doctor` red (exit 1) for
 * projects that were always fine. Reporting it informationally is still the
 * safety net for a detection miss at `init` time, which is the case that used to
 * leave no signal anywhere.
 */
function scanRootEntryPoints(rootDir, missingSeverity) {
    const issues = [];
    const rootEntryPoints = [];
    for (const relativePath of ENTRY_POINT_ALLOWLIST) {
        const fullPath = join(rootDir, relativePath);
        if (!pathEntryExists(fullPath))
            continue;
        if (isReadableRegularFile(fullPath)) {
            rootEntryPoints.push(relativePath);
            continue;
        }
        issues.push({
            code: 'root-entry-point-invalid',
            path: fullPath,
            message: `The root entry point is not a readable regular file: ${fullPath}`,
            severity: 'error',
        });
    }
    const missingRecommendedEntryPoints = RECOMMENDED_ENTRY_POINTS.filter((relativePath) => !rootEntryPoints.includes(relativePath));
    for (const relativePath of missingRecommendedEntryPoints) {
        issues.push({
            code: 'missing-recommended-entry-point',
            path: join(rootDir, relativePath),
            message: `Recommended entry point ${relativePath} is missing at the convention root; create it (e.g. via 'agentteams init --agent-files ${relativePath}') so agents can reach the conventions.`,
            severity: missingSeverity,
        });
    }
    return { rootEntryPoints, missingRecommendedEntryPoints, issues };
}
/**
 * A git root project has no member repos to manage, but it does own the
 * worktree bootstrap hook that makes `git worktree add` materialize
 * conventions. That hook was previously reachable only from the interactive
 * OAuth `init`, so any project configured before it existed had no way to get
 * one. Installing it — and reporting whether the conventions are reachable at
 * all — is the doctor's whole job for this layout; member repo management
 * (exclude, link, entry points) stays out of it.
 *
 * The hook is no longer installed unconditionally. `shouldInstallWorktreeHook`
 * is shared with `init` so the two cannot disagree: the second `agentteams init`
 * of a project takes the configured-project fast path, which calls this
 * function, and an ungated write here undid `init`'s decision not to touch the
 * shared `.git/hooks` of a repository that never uses worktrees.
 *
 * A project whose hook infrastructure the CLI must not touch is not a broken
 * project: it keeps exit 0 (the code a git root project has always returned)
 * and is told to use the manual per-worktree `agentteams init` fallback.
 */
function runGitRootDoctor(rootDir, installWorktreeHook) {
    const preflightIssues = validateRootPreflight(rootDir);
    if (preflightIssues.length > 0) {
        return {
            status: 'DEGRADED',
            layout: 'git-root',
            applicable: true,
            changedCount: 0,
            rootDir,
            rootEntryPoints: [],
            missingRecommendedEntryPoints: [],
            repositories: [],
            rootHook: 'skipped',
            issues: preflightIssues,
        };
    }
    const scan = scanRootEntryPoints(rootDir, 'info');
    const issues = [...scan.issues];
    let rootHook = 'skipped';
    let changedCount = 0;
    let hookDegraded = false;
    if (!shouldInstallWorktreeHook(rootDir, { force: installWorktreeHook })) {
        issues.push({
            code: 'post-checkout-hook-no-worktrees',
            path: null,
            message: "This repository has no linked git worktrees, so the worktree bootstrap hook was not installed. Run 'agentteams doctor --install-worktree-hook' to install it anyway.",
            severity: 'info',
        });
    }
    else {
        const hookResult = ensurePostCheckoutHook(rootDir);
        const blockedByUserHookConfig = hookResult.status === 'blocked' && USER_HOOK_CONFIG_CODES.has(hookResult.issue?.code ?? '');
        if (hookResult.issue) {
            issues.push(blockedByUserHookConfig
                ? {
                    ...hookResult.issue,
                    message: `${hookResult.issue.message} Run 'agentteams init' from the root of each new worktree instead.`,
                    severity: 'info',
                }
                : { ...hookResult.issue, severity: 'error' });
        }
        rootHook = hookResult.status;
        changedCount = hookResult.changed ? 1 : 0;
        hookDegraded = !(hookResult.status === 'ready' || blockedByUserHookConfig);
    }
    return {
        status: hookDegraded || issues.some((issue) => issue.severity === 'error') ? 'DEGRADED' : 'READY',
        layout: 'git-root',
        applicable: true,
        changedCount,
        rootDir,
        rootEntryPoints: scan.rootEntryPoints,
        missingRecommendedEntryPoints: scan.missingRecommendedEntryPoints,
        repositories: [],
        rootHook,
        issues,
    };
}
/**
 * Validate the root before any member mutation. The check never echoes the
 * config body or API key — only paths appear in issues.
 */
function validateRootPreflight(rootDir) {
    const issues = [];
    const configPath = join(rootDir, CONFIG_DIR, CONFIG_FILE);
    let config = null;
    try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
    catch {
        config = null;
    }
    if (!config) {
        issues.push({
            code: 'root-config-invalid',
            path: configPath,
            message: `The root config at ${configPath} is not valid JSON.`,
            severity: 'error',
        });
    }
    else {
        // A personal-login project deliberately keeps no `apiKey` on disk — the
        // credential lives in the OS credential store. Requiring one here would fail
        // preflight for every project created by the default `agentteams init`, and
        // `runGitRootDoctor` returns before `ensurePostCheckoutHook` on failure, so
        // the worktree bootstrap hook would never be installed.
        const requiredFields = config.authMode === 'personal-token' ? ['teamId', 'projectId'] : ['teamId', 'projectId', 'apiKey'];
        const missingFields = requiredFields.filter((field) => typeof config[field] !== 'string' || config[field].length === 0);
        if (missingFields.length > 0) {
            issues.push({
                code: 'root-config-incomplete',
                path: configPath,
                message: `The root config at ${configPath} is missing required fields: ${missingFields.join(', ')}.`,
                severity: 'error',
            });
        }
    }
    const conventionPath = join(rootDir, CONFIG_DIR, CONVENTION_FILE);
    if (!pathEntryExists(conventionPath)) {
        issues.push({
            code: 'root-convention-missing',
            path: conventionPath,
            message: `The root convention file is missing: ${conventionPath}`,
            severity: 'error',
        });
    }
    else if (!isReadableRegularFile(conventionPath)) {
        issues.push({
            code: 'root-convention-invalid',
            path: conventionPath,
            message: `The root convention path is not a readable regular file: ${conventionPath}`,
            severity: 'error',
        });
    }
    return issues;
}
function processMemberRepo(rootDir, repoDir, rootEntryPoints) {
    const issues = [];
    let changedCount = 0;
    const patterns = [
        toAnchoredExcludePattern(CONFIG_DIR),
        ...rootEntryPoints.map((relativePath) => toAnchoredExcludePattern(relativePath)),
    ];
    // Order matters: managed paths must be excluded before anything is created,
    // and the hook is only useful once the convention link is in place.
    const excludeResult = ensureLocalExclude(repoDir, patterns);
    if (excludeResult.changed)
        changedCount += 1;
    if (excludeResult.issue)
        issues.push(excludeResult.issue);
    let linkState;
    if (excludeResult.status === 'ready') {
        const linkResult = ensureConventionLink(rootDir, repoDir);
        if (linkResult.changed)
            changedCount += 1;
        if (linkResult.issue)
            issues.push(linkResult.issue);
        linkState = linkResult.state;
    }
    else {
        // Never create a managed path that exclude cannot keep out of git status;
        // report the current state without mutating anything.
        linkState = inspectConventionLink(rootDir, repoDir);
    }
    let hook;
    if (linkState === 'ready') {
        const hookResult = ensurePostCheckoutHook(repoDir);
        if (hookResult.changed)
            changedCount += 1;
        if (hookResult.issue)
            issues.push(hookResult.issue);
        hook = hookResult.status === 'ready' ? 'ready' : 'blocked';
    }
    else {
        hook = 'skipped';
    }
    const entryPointResult = ensureConventionEntryPoints(repoDir, rootEntryPoints, {
        allowCreate: excludeResult.status === 'ready' && linkState === 'ready',
        validateExistingReference: true,
    });
    changedCount += entryPointResult.changedCount;
    issues.push(...entryPointResult.issues);
    const conflicts = entryPointResult.entries
        .filter((entry) => !entry.compatible && (entry.state === 'tracked' || entry.state === 'existing'))
        .map(({ relativePath, state }) => ({ relativePath, state }));
    const ready = excludeResult.status === 'ready' &&
        linkState === 'ready' &&
        hook === 'ready' &&
        entryPointResult.ready &&
        conflicts.length === 0;
    return {
        path: repoDir,
        status: ready ? 'READY' : 'DEGRADED',
        changedCount,
        exclude: excludeResult.status === 'ready' ? 'ready' : 'blocked',
        link: linkState,
        hook,
        entryPointConflicts: conflicts,
        issues,
    };
}
export async function executeDoctorCommand(options) {
    return withCommandContext('doctor', async () => runDoctor(options));
}
function runDoctor(options) {
    const cwd = resolve(options?.cwd ?? process.cwd());
    const configPath = findProjectConfig(cwd);
    if (!configPath) {
        return notApplicableResult(null, {
            code: 'no-project-config',
            path: cwd,
            message: `No .agentteams/config.json was found from ${cwd}. Run 'agentteams init' at the project root first.`,
            severity: 'info',
        });
    }
    let rootDir;
    try {
        rootDir = dirname(dirname(realpathSync(configPath)));
    }
    catch {
        return notApplicableResult(null, {
            code: 'no-project-config',
            path: configPath,
            message: `The project config at ${configPath} could not be resolved.`,
            severity: 'info',
        });
    }
    // Repairing the config's own permissions applies to every layout, so it runs
    // before the layout branch and is merged into whichever result comes back.
    const configPermissions = repairConfigFilePermissions(rootDir);
    return withConfigPermissionFindings(runLayoutDoctor(rootDir, options?.installWorktreeHook === true), configPermissions);
}
function runLayoutDoctor(rootDir, installWorktreeHook) {
    if (!isNonGitRootProject(rootDir)) {
        return runGitRootDoctor(rootDir, installWorktreeHook);
    }
    const issues = [];
    const preflightIssues = validateRootPreflight(rootDir);
    if (preflightIssues.length > 0) {
        return {
            status: 'DEGRADED',
            layout: 'non-git-root',
            applicable: true,
            changedCount: 0,
            rootDir,
            rootEntryPoints: [],
            missingRecommendedEntryPoints: [],
            repositories: [],
            rootHook: 'skipped',
            issues: preflightIssues,
        };
    }
    const { rootEntryPoints, missingRecommendedEntryPoints, issues: entryPointIssues, } = scanRootEntryPoints(rootDir, 'error');
    issues.push(...entryPointIssues);
    const repositories = findMemberRepos(rootDir).map((repoDir) => processMemberRepo(rootDir, repoDir, [...rootEntryPoints]));
    // Daemon runners still refuse to create worktrees under a non-git root;
    // surfacing this as informational keeps readiness honest without failing it.
    issues.push({
        code: 'daemon-worktree-unsupported',
        path: null,
        message: 'AgentTeams runner daemons do not yet create worktrees under a non-git project root; runner-driven worktree flows remain unavailable (informational).',
        severity: 'info',
    });
    const degraded = issues.some((issue) => issue.severity === 'error') || repositories.some((repo) => repo.status === 'DEGRADED');
    return {
        status: degraded ? 'DEGRADED' : 'READY',
        layout: 'non-git-root',
        applicable: true,
        changedCount: repositories.reduce((sum, repo) => sum + repo.changedCount, 0),
        rootDir,
        rootEntryPoints: [...rootEntryPoints],
        missingRecommendedEntryPoints: [...missingRecommendedEntryPoints],
        repositories,
        // Hooks for this layout are installed per member repo, not on the root.
        rootHook: 'skipped',
        issues,
    };
}
//# sourceMappingURL=doctor.js.map