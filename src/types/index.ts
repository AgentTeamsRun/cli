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
export interface Config {
  /** Team ID from AgentTeams */
  teamId: string;
  /** Project ID from AgentTeams */
  projectId: string;
  /** Agent name (e.g., "claude-main", "opencode-agent") */
  agentName: string;
  /** API Key for authentication (stored securely) */
  apiKey: string;
  /** API URL (e.g., "http://localhost:3001") */
  apiUrl: string;
  repositoryId?: string;
}

/**
 * OAuth callback result from web authorization flow
 * Extends Config with additional metadata from OAuth callback
 */
export interface AuthResult extends Config {
  /** Agent config ID from API */
  configId: string;
  /** Convention file content and metadata */
  convention: ConventionFile;
}

// ============================================================
// Convention Types
// ============================================================

/**
 * Convention file structure returned from API
 * Contains the convention markdown content and filename
 */
export interface ConventionFile {
  /** Filename of the convention (e.g., "CLAUDE.md", "AGENTS.md") */
  fileName: string;
  /** Full markdown content of the convention */
  content: string;
}

// ============================================================
// Agent Configuration Types
// ============================================================

/** Supported agent environments */
export type AgentEnvironment = "CLAUDE_CODE" | "OPENCODE" | "CODEX";

/**
 * Agent configuration from API
 * Represents a registered agent in the system
 */
export interface AgentConfig {
  /** Unique identifier */
  id: string;
  /** Agent name */
  name: string;
  /** Environment type */
  environment: AgentEnvironment;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Soft delete timestamp (ISO 8601 or null) */
  deletedAt: string | null;
  /** Whether API key has been generated */
  hasApiKey?: boolean;
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

/**
 * Plan dependency relationship
 * Represents blocking/dependent relationships between plans
 */
export interface PlanDependency {
  /** Unique identifier */
  id: string;
  /** ID of plan that depends on another */
  dependentPlanId: string;
  /** ID of plan that blocks the dependent */
  blockingPlanId: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
}

/**
 * Plan dependencies container
 * Groups blocking and dependent plans for a given plan
 */
export interface PlanDependencies {
  /** Plans that block the current plan */
  blocking: Plan[];
  /** Plans that depend on the current plan */
  dependents: Plan[];
}

// ============================================================
// Comment Types
// ============================================================

/**
 * Comment on a plan
 * Represents feedback, notes, or status updates
 */
export interface Comment {
  /** Unique identifier */
  id: string;
  /** Associated plan ID */
  planId: string;
  createdByMemberId: string | null;
  createdByAgentId: string | null;
  createdByType: string | null;
  createdByName: string | null;
  /** Comment type (e.g., "NOTE", "FEEDBACK", "STATUS_UPDATE") */
  type: string;
  /** Comment content (markdown supported) */
  content: string;
  /** List of affected file paths */
  affectedFiles: string[];
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Soft delete timestamp (ISO 8601 or null) */
  deletedAt: string | null;
}

// ============================================================
// Completion Report Types
// ============================================================

/**
 * Completion report for plan or work session
 * Captures metrics and details about completed work
 */
export interface CompletionReport {
  /** Unique identifier */
  id: string;
  /** Project ID */
  projectId: string;
  /** Associated plan ID (null if not plan-specific) */
  planId: string | null;
  /** Report title */
  title: string;
  /** Report content (markdown supported) */
  content: string;
  /** Git commit hash (null if not applicable) */
  commitHash: string | null;
  /** Git commit range start (null if not applicable) */
  commitStart: string | null;
  /** Git commit range end (null if not applicable) */
  commitEnd: string | null;
  /** Git branch name (null if not applicable) */
  branchName: string | null;
  /** Pull request ID (null if not applicable) */
  pullRequestId: string | null;
  /** Duration in seconds (null if not tracked) */
  durationSeconds: number | null;
  /** Number of files modified (null if not tracked) */
  filesModified: number | null;
  /** Number of lines added (null if not tracked) */
  linesAdded: number | null;
  /** Number of lines deleted (null if not tracked) */
  linesDeleted: number | null;
  /** Report status (e.g., "COMPLETED", "FAILED", "PARTIAL") */
  status: string;
  /** Quality score 0-100 (null if not scored) */
  qualityScore: number | null;
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
// API Response Envelope Types
// ============================================================

/**
 * Generic API response envelope for single resource
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T;
}

/**
 * Generic API response envelope for list of resources
 */
export interface ApiListResponse<T> {
  /** Array of resources */
  data: T[];
  /** Total count of resources (for pagination) */
  total?: number;
  /** Current page number (for pagination) */
  page?: number;
  /** Items per page (for pagination) */
  limit?: number;
}

/**
 * API error response
 */
export interface ApiError {
  /** HTTP status code */
  statusCode: number;
  /** Error type/name */
  error: string;
  /** Human-readable error message */
  message: string;
  errorCode?: string;
}

// ============================================================
// CLI Command Option Types
// ============================================================

/**
 * Common CLI output format options
 */
export type OutputFormat = "json" | "text";

/**
 * CLI command context
 * Passed to all command handlers
 */
export interface CliContext {
  /** Loaded configuration */
  config: Config;
  /** Output format preference */
  format: OutputFormat;
  /** Verbose logging enabled */
  verbose?: boolean;
}
