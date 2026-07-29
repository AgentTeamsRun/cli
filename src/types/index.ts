/**
 * CLI Type Definitions
 * Defines all TypeScript types used across the CLI application
 */

// ============================================================
// Configuration Types
// ============================================================

/**
 * CLI Configuration stored in .agentteams/config.json
 * Contains credentials and project context for API communication
 */
/**
 * Which credential family this project is configured to authenticate with.
 *
 * `personal-token` is the default: project config stays secret-free while a
 * rotating refresh token lives in the OS credential store. `api-key` is the
 * explicit compatibility path for existing automation and legacy projects.
 */
export type AuthMode = 'api-key' | 'personal-token';

export interface Config {
  /** Team ID from AgentTeams */
  teamId: string;
  /** Project ID from AgentTeams */
  projectId: string;
  /** API Key for authentication (stored securely) */
  apiKey: string;
  /** API URL (e.g., "http://localhost:3001") */
  apiUrl: string;
  /** Legacy migration marker; absent configs choose by whether an apiKey exists. */
  authMode?: AuthMode;
}

// ============================================================
// Plan Types
// ============================================================

/**
 * Plan from API
 * Represents a work item or assignment
 */
export interface Plan {
  /** Unique identifier */
  id: string;
  /** Plan title */
  title: string;
  /** Detailed description */
  description: string;
  type?: string | null;
  /** Current status (e.g., "TODO", "IN_PROGRESS", "DONE") */
  status: string;
  /** ID of assigned agent/user (null if unassigned) */
  assignedTo: string | null;
  /** Priority level (e.g., "LOW", "MEDIUM", "HIGH") */
  priority: string;
  createdByMemberId?: string | null;
  createdByAgentId?: string | null;
  createdByType?: string | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Soft delete timestamp (ISO 8601 or null) */
  deletedAt: string | null;
}

// ============================================================
// CLI Command Option Types
// ============================================================

/**
 * Common CLI output format options
 */
export type OutputFormat = 'json';
