/**
 * `projectId` is the project the CLI is configured against; `--project-id` already
 * folded into it through `buildConfigOverrides()` upstream, so callers do not need
 * to re-read `options.projectId` here. Every action forwards it because the route
 * resolves the project from `request.user.projectId` first and the `projectId`
 * query second — only an agent API key carries the former.
 */
export declare function executeLinearCommand(apiUrl: string, projectId: string, headers: any, action: string, options: any): Promise<any>;
//# sourceMappingURL=linear.d.ts.map