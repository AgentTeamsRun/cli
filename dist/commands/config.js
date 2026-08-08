import { findProjectConfig, loadConfigWithCredential, loadProjectConfig } from '../utils/config.js';
export async function executeConfigCommand(action) {
    switch (action) {
        case 'whoami': {
            const configPath = findProjectConfig(process.cwd());
            const authMode = loadProjectConfig()?.authMode ?? null;
            // `whoami` is the command people run *because* something is wrong, so a
            // credential that cannot be resolved is reported, never thrown.
            let config = null;
            let problem;
            try {
                config = await loadConfigWithCredential();
            }
            catch (error) {
                problem = error instanceof Error ? error.message : String(error);
            }
            if (!config) {
                return {
                    apiUrl: process.env.AGENTTEAMS_API_URL,
                    projectId: process.env.AGENTTEAMS_PROJECT_ID,
                    teamId: process.env.AGENTTEAMS_TEAM_ID,
                    hasApiKey: Boolean(process.env.AGENTTEAMS_API_KEY),
                    authMode,
                    configPath,
                    ...(problem ? { problem } : {}),
                };
            }
            return {
                apiUrl: config.apiUrl,
                projectId: config.projectId,
                teamId: config.teamId,
                hasApiKey: Boolean(config.apiKey),
                credentialSource: config.credentialSource,
                authMode,
                configPath,
            };
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=config.js.map