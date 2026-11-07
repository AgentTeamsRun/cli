// Mirror of `normalizeRunnerType` in `packages/core-constants/index.js`.
// The CLI is published to npm and cannot depend on the private `@agentteams/core-constants`
// package, so the canonical values and aliases are copied here by hand.
// `scripts/cli-runner-type-alias-contract.test.mjs` imports both and fails on any drift, so
// change the two together. This file must stay import-free: the contract test loads it
// before workspace dependencies are installed.
const CANONICAL_RUNNER_TYPES = [
    'OPENCODE',
    'CLAUDE_CODE',
    'CODEX',
    'ANTIGRAVITY',
    'AMP',
    'COPILOT_CLI',
    'CURSOR_CLI',
    'KIMI_CLI',
    'KIRO_CLI',
    'GROK_BUILD',
    'OMP',
    'MUSE_CODE',
    'GEMINI',
];
const RUNNER_TYPE_ALIASES = {
    CLAUDE: 'CLAUDE_CODE',
    ANTIGRAVITY_CLI: 'ANTIGRAVITY',
    KIMI: 'KIMI_CLI',
    COPILOT: 'COPILOT_CLI',
    CURSOR: 'CURSOR_CLI',
    KIRO: 'KIRO_CLI',
    GROK: 'GROK_BUILD',
    MUSE: 'MUSE_CODE',
};
const NORMALIZED_RUNNER_TYPES = new Map([
    ...CANONICAL_RUNNER_TYPES.map((runnerType) => [runnerType, runnerType]),
    ...Object.entries(RUNNER_TYPE_ALIASES),
]);
/** Same contract as the shared helper: canonical value, or null when the engine cannot be identified. */
export function normalizeRunnerType(value) {
    if (typeof value !== 'string')
        return null;
    return NORMALIZED_RUNNER_TYPES.get(value.trim().toUpperCase().replaceAll('-', '_')) ?? null;
}
/** Exposed for the contract test so it can compare the full input domain, not just samples. */
export const RUNNER_TYPE_ALIAS_INPUTS = [...NORMALIZED_RUNNER_TYPES.keys()];
//# sourceMappingURL=runnerTypeAliases.js.map