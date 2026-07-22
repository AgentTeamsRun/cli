import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveGitTopLevel, resolveMainCheckoutRoot } from './git.js';
const CONFIG_DIR = '.agentteams';
const CONFIG_FILE = 'config.json';
export const DEFAULT_API_URL = 'https://api.agentteams.run';
const CONFIGURATION_NOT_FOUND_MESSAGE = "Configuration not found. Run 'agentteams init' first or set AGENTTEAMS_* environment variables.";
function readConfigFile(filePath) {
    try {
        if (!existsSync(filePath))
            return null;
        const raw = readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Load config values from environment variables.
 * Only includes fields that have corresponding env vars set.
 *
 * Mapping:
 *   AGENTTEAMS_API_KEY    → apiKey
 *   AGENTTEAMS_API_URL    → apiUrl
 *   AGENTTEAMS_TEAM_ID    → teamId
 *   AGENTTEAMS_PROJECT_ID → projectId
 */
function loadEnvConfig() {
    const env = {};
    if (process.env.AGENTTEAMS_API_KEY)
        env.apiKey = process.env.AGENTTEAMS_API_KEY;
    if (process.env.AGENTTEAMS_API_URL)
        env.apiUrl = process.env.AGENTTEAMS_API_URL;
    if (process.env.AGENTTEAMS_TEAM_ID)
        env.teamId = process.env.AGENTTEAMS_TEAM_ID;
    if (process.env.AGENTTEAMS_PROJECT_ID)
        env.projectId = process.env.AGENTTEAMS_PROJECT_ID;
    return env;
}
/**
 * Find the nearest .agentteams/config.json by walking up from startDir to root.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to config.json, or null if not found
 */
export function findProjectConfig(startDir) {
    let current = resolve(startDir);
    const repositoryRoot = resolveGitTopLevel(current);
    if (repositoryRoot) {
        try {
            current = realpathSync(current);
        }
        catch {
            return null;
        }
    }
    while (true) {
        const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(candidate))
            return candidate;
        // Repository-scoped lookup must not silently adopt a parent project's or $HOME config.
        if (repositoryRoot && current === repositoryRoot)
            break;
        const parent = dirname(current);
        if (parent === current)
            break; // reached filesystem root
        current = parent;
    }
    const mainCheckoutRoot = repositoryRoot ? resolveMainCheckoutRoot(repositoryRoot) : null;
    if (mainCheckoutRoot) {
        const mainCheckoutConfig = join(mainCheckoutRoot, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(mainCheckoutConfig))
            return mainCheckoutConfig;
    }
    return null;
}
export function getConfigurationNotFoundMessage(startDir = process.cwd(), userHomeDir = homedir()) {
    const repositoryRoot = resolveGitTopLevel(resolve(startDir));
    if (!repositoryRoot)
        return CONFIGURATION_NOT_FOUND_MESSAGE;
    const homeDir = realpathSync(resolve(userHomeDir));
    let current = dirname(repositoryRoot);
    while (current !== homeDir) {
        const candidate = join(current, CONFIG_DIR, CONFIG_FILE);
        if (existsSync(candidate) && resolveGitTopLevel(current) === null) {
            return `${CONFIGURATION_NOT_FOUND_MESSAGE} A parent workspace config was found outside this repository. Run 'agentteams doctor' from the workspace root to materialize .agentteams.`;
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return CONFIGURATION_NOT_FOUND_MESSAGE;
}
/**
 * Load configuration with priority-based merging.
 *
 * Priority (highest → lowest):
 *   1. CLI options (passed as argument)
 *   2. Environment variables (AGENTTEAMS_*)
 *   3. Project config (.agentteams/config.json in nearest ancestor)
 *   4. Global config (~/.agentteams/config.json)
 *
 * @param options - CLI argument overrides (highest priority)
 * @returns Merged Config if all required fields are present, otherwise null
 */
export function loadConfig(options) {
    const globalPath = join(homedir(), CONFIG_DIR, CONFIG_FILE);
    const globalConfig = readConfigFile(globalPath) ?? {};
    const projectPath = findProjectConfig(process.cwd());
    const projectConfig = projectPath ? (readConfigFile(projectPath) ?? {}) : {};
    const envConfig = loadEnvConfig();
    const cliOptions = options ?? {};
    const merged = {
        apiUrl: DEFAULT_API_URL,
        ...globalConfig,
        ...projectConfig,
        ...envConfig,
        ...cliOptions,
    };
    const requiredFields = ['teamId', 'projectId', 'apiKey'];
    const hasAllFields = requiredFields.every((field) => typeof merged[field] === 'string' && merged[field].length > 0);
    if (!hasAllFields)
        return null;
    return merged;
}
/**
 * Save configuration to a JSON file.
 * Creates parent directories if they don't exist.
 *
 * @param configPath - Absolute path to write the config file
 * @param config - Configuration object to persist
 * @throws Error if write fails
 */
export function saveConfig(configPath, config) {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
//# sourceMappingURL=config.js.map