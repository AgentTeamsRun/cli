import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findProjectConfig } from '../utils/config.js';
import { findMemberRepos, isNonGitRootProject } from '../utils/projectLayout.js';
import {
  ensureConventionEntryPoints,
  ensureConventionLink,
  ensureLocalExclude,
  ensurePostCheckoutHook,
  inspectConventionLink,
  isReadableRegularFile,
  toAnchoredExcludePattern,
  type ConventionIssue,
  type ConventionLinkState,
} from '../utils/conventionLink.js';
import { withCommandContext } from '../utils/commandContext.js';

const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
const CONVENTION_FILE = 'convention.md';

// Mirrors AGENT_ENTRY_POINT_FILES in commands/init.ts — the doctor only reads
// which of these exist at the convention root; it never creates root files.
const ENTRY_POINT_ALLOWLIST = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursor/rules/agentteams.mdc'] as const;
const RECOMMENDED_ENTRY_POINTS = ['CLAUDE.md', 'AGENTS.md'] as const;

export type DoctorStatus = 'READY' | 'DEGRADED' | 'NOT_APPLICABLE';

export interface DoctorIssue {
  code: string;
  path: string | null;
  message: string;
  severity: 'error' | 'info';
}

export interface DoctorEntryPointConflict {
  relativePath: string;
  state: 'tracked' | 'existing';
}

export interface DoctorRepositoryResult {
  path: string;
  status: 'READY' | 'DEGRADED';
  changedCount: number;
  exclude: 'ready' | 'blocked';
  link: ConventionLinkState;
  hook: 'ready' | 'blocked' | 'skipped';
  entryPointConflicts: DoctorEntryPointConflict[];
  issues: ConventionIssue[];
}

export interface DoctorResult {
  status: DoctorStatus;
  applicable: boolean;
  changedCount: number;
  rootDir: string | null;
  rootEntryPoints: string[];
  missingRecommendedEntryPoints: string[];
  repositories: DoctorRepositoryResult[];
  issues: DoctorIssue[];
}

type DoctorOptions = {
  cwd?: string;
};

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function notApplicableResult(rootDir: string | null, issue: DoctorIssue): DoctorResult {
  return {
    status: 'NOT_APPLICABLE',
    applicable: false,
    changedCount: 0,
    rootDir,
    rootEntryPoints: [],
    missingRecommendedEntryPoints: [],
    repositories: [],
    issues: [issue],
  };
}

/**
 * Validate the root before any member mutation. The check never echoes the
 * config body or API key — only paths appear in issues.
 */
function validateRootPreflight(rootDir: string): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const configPath = join(rootDir, CONFIG_DIR, CONFIG_FILE);

  let config: Record<string, unknown> | null = null;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    config = null;
  }

  if (!config) {
    issues.push({
      code: 'root-config-invalid',
      path: configPath,
      message: `The root config at ${configPath} is not valid JSON.`,
      severity: 'error',
    });
  } else {
    const missingFields = ['teamId', 'projectId', 'apiKey'].filter(
      (field) => typeof config[field] !== 'string' || (config[field] as string).length === 0,
    );
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
  } else if (!isReadableRegularFile(conventionPath)) {
    issues.push({
      code: 'root-convention-invalid',
      path: conventionPath,
      message: `The root convention path is not a readable regular file: ${conventionPath}`,
      severity: 'error',
    });
  }

  return issues;
}

function processMemberRepo(rootDir: string, repoDir: string, rootEntryPoints: string[]): DoctorRepositoryResult {
  const issues: ConventionIssue[] = [];
  let changedCount = 0;

  const patterns = [
    toAnchoredExcludePattern(CONFIG_DIR),
    ...rootEntryPoints.map((relativePath) => toAnchoredExcludePattern(relativePath)),
  ];

  // Order matters: managed paths must be excluded before anything is created,
  // and the hook is only useful once the convention link is in place.
  const excludeResult = ensureLocalExclude(repoDir, patterns);
  if (excludeResult.changed) changedCount += 1;
  if (excludeResult.issue) issues.push(excludeResult.issue);

  let linkState: ConventionLinkState;
  if (excludeResult.status === 'ready') {
    const linkResult = ensureConventionLink(rootDir, repoDir);
    if (linkResult.changed) changedCount += 1;
    if (linkResult.issue) issues.push(linkResult.issue);
    linkState = linkResult.state;
  } else {
    // Never create a managed path that exclude cannot keep out of git status;
    // report the current state without mutating anything.
    linkState = inspectConventionLink(rootDir, repoDir);
  }

  let hook: DoctorRepositoryResult['hook'];
  if (linkState === 'ready') {
    const hookResult = ensurePostCheckoutHook(repoDir);
    if (hookResult.changed) changedCount += 1;
    if (hookResult.issue) issues.push(hookResult.issue);
    hook = hookResult.status === 'ready' ? 'ready' : 'blocked';
  } else {
    hook = 'skipped';
  }

  const entryPointResult = ensureConventionEntryPoints(repoDir, rootEntryPoints, {
    allowCreate: excludeResult.status === 'ready' && linkState === 'ready',
    validateExistingReference: true,
  });
  changedCount += entryPointResult.changedCount;
  issues.push(...entryPointResult.issues);
  const conflicts: DoctorEntryPointConflict[] = entryPointResult.entries
    .filter(
      (entry): entry is typeof entry & { state: DoctorEntryPointConflict['state'] } =>
        !entry.compatible && (entry.state === 'tracked' || entry.state === 'existing'),
    )
    .map(({ relativePath, state }) => ({ relativePath, state }));

  const ready =
    excludeResult.status === 'ready' &&
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

export async function executeDoctorCommand(options?: DoctorOptions): Promise<DoctorResult> {
  return withCommandContext('doctor', async () => runDoctor(options));
}

function runDoctor(options?: DoctorOptions): DoctorResult {
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

  let rootDir: string;
  try {
    rootDir = dirname(dirname(realpathSync(configPath)));
  } catch {
    return notApplicableResult(null, {
      code: 'no-project-config',
      path: configPath,
      message: `The project config at ${configPath} could not be resolved.`,
      severity: 'info',
    });
  }

  if (!isNonGitRootProject(rootDir)) {
    return notApplicableResult(rootDir, {
      code: 'git-root-project',
      path: rootDir,
      message: `${rootDir} is a git repository root project; the doctor only manages non-git root projects.`,
      severity: 'info',
    });
  }

  const issues: DoctorIssue[] = [];

  const preflightIssues = validateRootPreflight(rootDir);
  if (preflightIssues.length > 0) {
    return {
      status: 'DEGRADED',
      applicable: true,
      changedCount: 0,
      rootDir,
      rootEntryPoints: [],
      missingRecommendedEntryPoints: [],
      repositories: [],
      issues: preflightIssues,
    };
  }

  const rootEntryPoints: string[] = [];
  for (const relativePath of ENTRY_POINT_ALLOWLIST) {
    const fullPath = join(rootDir, relativePath);
    if (!pathEntryExists(fullPath)) continue;
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
  const missingRecommendedEntryPoints = RECOMMENDED_ENTRY_POINTS.filter(
    (relativePath) => !rootEntryPoints.includes(relativePath),
  );

  for (const relativePath of missingRecommendedEntryPoints) {
    issues.push({
      code: 'missing-recommended-entry-point',
      path: join(rootDir, relativePath),
      message: `Recommended entry point ${relativePath} is missing at the convention root; create it (e.g. via 'agentteams init') so agents can reach the conventions.`,
      severity: 'error',
    });
  }

  const repositories = findMemberRepos(rootDir).map((repoDir) =>
    processMemberRepo(rootDir, repoDir, [...rootEntryPoints]),
  );

  // Daemon runners still refuse to create worktrees under a non-git root;
  // surfacing this as informational keeps readiness honest without failing it.
  issues.push({
    code: 'daemon-worktree-unsupported',
    path: null,
    message:
      'AgentTeams runner daemons do not yet create worktrees under a non-git project root; runner-driven worktree flows remain unavailable (informational).',
    severity: 'info',
  });

  const degraded =
    issues.some((issue) => issue.severity === 'error') || repositories.some((repo) => repo.status === 'DEGRADED');

  return {
    status: degraded ? 'DEGRADED' : 'READY',
    applicable: true,
    changedCount: repositories.reduce((sum, repo) => sum + repo.changedCount, 0),
    rootDir,
    rootEntryPoints: [...rootEntryPoints],
    missingRecommendedEntryPoints: [...missingRecommendedEntryPoints],
    repositories,
    issues,
  };
}
