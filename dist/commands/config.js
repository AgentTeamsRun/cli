import { findProjectConfig, loadConfig } from '../utils/config.js';
export async function executeConfigCommand(action) {
    switch (action) {
        case 'whoami': {
            const configPath = findProjectConfig(process.cwd());
            const config = loadConfig();
            if (!config) {
                return {
                    apiUrl: process.env.AGENTTEAMS_API_URL,
                    projectId: process.env.AGENTTEAMS_PROJECT_ID,
                    teamId: process.env.AGENTTEAMS_TEAM_ID,
                    agentName: process.env.AGENTTEAMS_AGENT_NAME,
                    hasApiKey: Boolean(process.env.AGENTTEAMS_API_KEY),
                    configPath,
                };
            }
            return {
                apiUrl: config.apiUrl,
                projectId: config.projectId,
                teamId: config.teamId,
                agentName: config.agentName,
                hasApiKey: Boolean(config.apiKey),
                configPath,
            };
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=config.js.map