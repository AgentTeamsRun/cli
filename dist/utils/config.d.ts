import type { Config } from "../types/index.js";
/**
 * Find the nearest .agentteams/config.json by walking up from startDir to root.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to config.json, or null if not found
 */
export declare function findProjectConfig(startDir: string): string | null;
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
export declare function loadConfig(options?: Partial<Config>): Config | null;
/**
 * Save configuration to a JSON file.
 * Creates parent directories if they don't exist.
 *
 * @param configPath - Absolute path to write the config file
 * @param config - Configuration object to persist
 * @throws Error if write fails
 */
export declare function saveConfig(configPath: string, config: Config): void;
//# sourceMappingURL=config.d.ts.map