/**
 * The agent entry point files init knows how to write, and the AI client each
 * one belongs to.
 *
 * This catalog lives outside `commands/init.ts` because both the new-project
 * path and the linked-worktree bootstrap read it, and those now sit in
 * different modules. `commands/doctor.ts` keeps its own read-only mirror
 * (`ENTRY_POINT_ALLOWLIST`) on purpose — it never creates these files.
 */
export declare const AGENT_ENTRY_POINT_FILES: readonly [{
    readonly value: "CLAUDE.md";
    readonly label: "CLAUDE.md";
    readonly hint: "Claude Code";
}, {
    readonly value: "AGENTS.md";
    readonly label: "AGENTS.md";
    readonly hint: "OpenCode / Codex / Kimi CLI / Kiro CLI";
}, {
    readonly value: "GEMINI.md";
    readonly label: "GEMINI.md";
    readonly hint: "Antigravity";
}, {
    readonly value: ".cursor/rules/agentteams.mdc";
    readonly label: ".cursor/rules/agentteams.mdc";
    readonly hint: "Cursor";
}];
export type AgentEntryPointValue = (typeof AGENT_ENTRY_POINT_FILES)[number]['value'];
export declare const AGENT_ENTRY_POINT_VALUES: AgentEntryPointValue[];
/** The literal `--agent-files` value that means "create nothing". */
export declare const AGENT_FILES_NONE = "none";
/**
 * What init falls back to when the folder gives no signal at all.
 *
 * Detection on markers alone misses the most common case there is: a repository
 * created or cloned minutes ago, where Claude Code's project-local `.claude/`
 * does not exist until the user approves project scope. Selecting nothing there
 * leaves the project with no path from an agent to
 * `.agentteams/convention.md` — the one thing an entry point exists to provide —
 * so one file is created rather than none. `--agent-files none` is how a caller
 * says it really wants nothing.
 */
export declare const AGENT_ENTRY_POINT_FALLBACK: readonly AgentEntryPointValue[];
/**
 * Which AI clients this folder actually uses.
 *
 * Two signals count: the client's own configuration directory, and an entry
 * point file that is already there. The second one never produces a write — init
 * does not overwrite an existing entry point — but it is what tells the adapters
 * downstream which clients are in play, so a repository that keeps a hand-written
 * `GEMINI.md` still gets its `.geminiignore`, and the skip is reported against a
 * file the user can see rather than silently dropped.
 *
 * With neither signal the fallback applies. Detection still narrows what init
 * used to create unconditionally (four files on every run); `--agent-files` is
 * the way to widen or empty it explicitly.
 */
export declare function detectAgentEntryPointFiles(cwd: string): AgentEntryPointValue[];
/**
 * Parse the raw `--agent-files` value.
 *
 * `null` means "no explicit choice" — the caller falls back to detection or the
 * interactive prompt. An empty array (from `none`) is an explicit choice and is
 * therefore *not* the same thing. An unknown value throws rather than being
 * dropped: silently ignoring a typo would create a different file set than the
 * one the caller asked for, and init only reports what it wrote.
 */
export declare function parseAgentFilesOption(raw: unknown): AgentEntryPointValue[] | null;
//# sourceMappingURL=agentEntryPoints.d.ts.map