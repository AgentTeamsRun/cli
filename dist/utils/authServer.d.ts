import { type Server } from 'node:http';
export type AuthResult = {
    teamId: string;
    projectId: string;
    repositoryId: string;
    agentName: string;
    apiKey: string;
    apiUrl: string;
    configId: string;
};
type AuthServerResult = {
    server: Server;
    waitForCallback: () => Promise<AuthResult>;
    port: number;
};
export declare function startLocalAuthServer(): AuthServerResult;
export {};
//# sourceMappingURL=authServer.d.ts.map