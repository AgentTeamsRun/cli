/**
 * A "non-git root project" is a directory that carries an AgentTeams config
 * but is not itself inside a git work tree — e.g. a parent folder that groups
 * several member repositories. Subdirectories of a git repository are never
 * treated as non-git roots, so the repo-root config barrier stays intact.
 */
export declare function isNonGitRootProject(rootDir: string): boolean;
/**
 * Discover member git repositories directly under a non-git project root.
 *
 * Only physical directories at depth 1 are considered: hidden directories,
 * `node_modules`, symlinked directories, and bare repositories are excluded.
 * A candidate is a member only when its canonical path is itself the top
 * level of a git work tree. Results are sorted by path so repeated runs are
 * deterministic. The returned list never contains config contents or keys —
 * only directory paths.
 */
export declare function findMemberRepos(rootDir: string): string[];
//# sourceMappingURL=projectLayout.d.ts.map