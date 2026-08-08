import { statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The agent entry point files init knows how to write, and the AI client each
 * one belongs to.
 *
 * This catalog lives outside `commands/init.ts` because both the new-project
 * path and the linked-worktree bootstrap read it, and those now sit in
 * different modules. `commands/doctor.ts` keeps its own read-only mirror
 * (`ENTRY_POINT_ALLOWLIST`) on purpose — it never creates these files.
 */
export const AGENT_ENTRY_POINT_FILES = [
  { value: 'CLAUDE.md', label: 'CLAUDE.md', hint: 'Claude Code' },
  { value: 'AGENTS.md', label: 'AGENTS.md', hint: 'OpenCode / Codex / Kimi CLI / Kiro CLI' },
  { value: 'GEMINI.md', label: 'GEMINI.md', hint: 'Antigravity' },
  { value: '.cursor/rules/agentteams.mdc', label: '.cursor/rules/agentteams.mdc', hint: 'Cursor' },
] as const;

export type AgentEntryPointValue = (typeof AGENT_ENTRY_POINT_FILES)[number]['value'];

export const AGENT_ENTRY_POINT_VALUES: AgentEntryPointValue[] = AGENT_ENTRY_POINT_FILES.map((file) => file.value);

/** The literal `--agent-files` value that means "create nothing". */
export const AGENT_FILES_NONE = 'none';

/**
 * The client configuration directory that proves a folder uses that client.
 *
 * A marker only earns a place here once the client is known to read the entry
 * point it maps to — otherwise init writes a file the agent never opens and the
 * repository looks configured while the agent still cannot reach
 * `.agentteams/convention.md`. Verified 2026-08-08 with kiro-cli 2.16.2: it reads
 * `AGENTS.md` and does *not* read `CLAUDE.md`, so a `.kiro`-only repository would
 * otherwise fall back to `CLAUDE.md` and hand Kiro nothing.
 */
const AGENT_CLIENT_MARKER_DIRS: Record<AgentEntryPointValue, readonly string[]> = {
  'CLAUDE.md': ['.claude'],
  'AGENTS.md': ['.codex', '.opencode', '.kimi-code', '.kiro'],
  'GEMINI.md': ['.gemini', '.antigravity'],
  '.cursor/rules/agentteams.mdc': ['.cursor'],
};

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
export const AGENT_ENTRY_POINT_FALLBACK: readonly AgentEntryPointValue[] = ['CLAUDE.md'];

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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
export function detectAgentEntryPointFiles(cwd: string): AgentEntryPointValue[] {
  const detected = AGENT_ENTRY_POINT_VALUES.filter(
    (value) =>
      AGENT_CLIENT_MARKER_DIRS[value].some((marker) => isDirectory(join(cwd, marker))) || isFile(join(cwd, value)),
  );

  return detected.length > 0 ? detected : [...AGENT_ENTRY_POINT_FALLBACK];
}

/**
 * Parse the raw `--agent-files` value.
 *
 * `null` means "no explicit choice" — the caller falls back to detection or the
 * interactive prompt. An empty array (from `none`) is an explicit choice and is
 * therefore *not* the same thing. An unknown value throws rather than being
 * dropped: silently ignoring a typo would create a different file set than the
 * one the caller asked for, and init only reports what it wrote.
 */
export function parseAgentFilesOption(raw: unknown): AgentEntryPointValue[] | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(`Invalid --agent-files value. Expected a comma-separated list or '${AGENT_FILES_NONE}'.`);
  }

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;
  if (tokens.some((token) => token.toLowerCase() === AGENT_FILES_NONE)) {
    if (tokens.length > 1) {
      throw new Error(`Invalid --agent-files value: '${AGENT_FILES_NONE}' cannot be combined with other files.`);
    }
    return [];
  }

  const selected: AgentEntryPointValue[] = [];
  for (const token of tokens) {
    const match = AGENT_ENTRY_POINT_VALUES.find((value) => value === token);
    if (!match) {
      throw new Error(
        `Unknown --agent-files value: '${token}'. Valid values: ${AGENT_ENTRY_POINT_VALUES.join(', ')}, ${AGENT_FILES_NONE}.`,
      );
    }
    if (!selected.includes(match)) selected.push(match);
  }

  return selected;
}
