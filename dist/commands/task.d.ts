import { collectGitMetrics, collectTaskFinishGitSnapshot, getGitRemoteOriginUrl } from '../utils/git.js';
export type TaskCommandDependencies = {
    collectTaskFinishGitSnapshot?: typeof collectTaskFinishGitSnapshot;
    collectGitMetrics?: typeof collectGitMetrics;
    getGitRemoteOriginUrl?: typeof getGitRemoteOriginUrl;
    env?: NodeJS.ProcessEnv;
};
export declare function executeTaskCommand(apiUrl: string, projectId: string, headers: Record<string, string>, action: string, options: Record<string, unknown>, deps?: TaskCommandDependencies): Promise<unknown>;
//# sourceMappingURL=task.d.ts.map