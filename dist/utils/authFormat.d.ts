/**
 * Human-readable rendering of `agentteams auth` results.
 *
 * `auth` is read by a person deciding what to do next — "am I signed in, as whom,
 * and against which server" — not by a script assembling a payload. The JSON view
 * is still available behind an explicit `--format json` for the scripts that read
 * the documented fields.
 *
 * Lines are `Label: value` so the output stays greppable, and every line answers a
 * question a user actually asks. Anything the payload does not contain is omitted
 * rather than printed as `null`.
 */
/**
 * Render an `auth` result as text. Unknown actions fall back to JSON so a new
 * subcommand is never silently reduced to nothing.
 */
export declare function formatAuthResultText(action: string, result: unknown): string;
//# sourceMappingURL=authFormat.d.ts.map