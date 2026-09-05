/**
 * Runner types the platform supports, mirroring `RUNNER_TYPES` in
 * `packages/core-constants`.
 *
 * The published CLI is a `cli/`-only subtree split, so the SSOT cannot be a runtime
 * import here — the same constraint `mcp-registration/clients.ts` documents. A
 * monorepo-only drift test (`test/runner-types.test.ts`) is what keeps this list honest.
 *
 * `GEMINI` is intentionally absent: it is a deprecated value kept only so historical
 * snapshots still deserialize, never a value to advertise as selectable.
 */
export declare const RUNNER_TYPE_VALUES: readonly ["OPENCODE", "CLAUDE_CODE", "CODEX", "ANTIGRAVITY", "AMP", "COPILOT_CLI", "CURSOR_CLI", "KIMI_CLI", "KIRO_CLI", "GROK_BUILD", "OMP", "MUSE_CODE"];
/**
 * Help text for `--runner-type`. Kept as one string so every command that accepts the
 * flag advertises the same set — previously four commands listed five stale values and
 * four listed none, so `--help` disagreed with what the server actually accepts.
 *
 * The text is the bare value list — no "Runner type snapshot:" prefix — because the option
 * name `--runner-type` already says what it is, and the per-command help byte budgets in
 * `test/guide-command-smoke.test.ts` are tight enough that going from five values to nine
 * does not fit otherwise. Those budgets exist because this help is agent-facing context, so
 * its size is a token cost paid on every run; `|` separators and the dropped prefix keep the
 * corrected list cheaper than the stale five-value sentence it replaces.
 *
 * The "filled in automatically from the runner session" hint deliberately lives on the error
 * message instead of here — it is only useful at the moment the value is actually missing.
 */
export declare const RUNNER_TYPE_OPTION_DESCRIPTION: string;
//# sourceMappingURL=runnerTypes.d.ts.map