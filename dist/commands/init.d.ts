type InitOptions = {
    cwd?: string;
};
export type AgentFileEntry = {
    relativePath: string;
    type: 'created' | 'example';
};
type InitResult = {
    success: true;
    authUrl: string;
    configPath: string;
    conventionPath: string;
    teamId: string;
    projectId: string;
    agentName: string;
    agentFiles: AgentFileEntry[];
};
export declare function detectOsType(): 'MACOS' | 'LINUX' | 'WINDOWS' | undefined;
export declare function buildAuthorizeUrl(port: number, projectName: string, authPathEnc?: string, osType?: string): string;
export declare function executeInitCommand(options?: InitOptions): Promise<InitResult>;
export {};
//# sourceMappingURL=init.d.ts.map